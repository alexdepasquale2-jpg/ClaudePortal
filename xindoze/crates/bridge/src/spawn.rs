//! Runs a program with a timeout and bounded output capture. Shared by
//! `proc.spawn` and the CLI Ancestors.

use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::task::JoinHandle;
use xz_types::path::resolve;
use xz_types::{Effect, Result, ToolOutput, XzError};

/// Bytes kept from each of stdout and stderr.
pub(crate) const OUTPUT_LIMIT: usize = 64 * 1024;

/// How long to keep reading after the program ended. A background
/// grandchild can hold the pipes open forever.
const DRAIN_GRACE: Duration = Duration::from_secs(1);

/// What a finished (or killed) program left behind.
#[derive(Debug)]
pub(crate) struct Finished {
    /// None when the program was killed (timeout or signal).
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    /// True if either stream exceeded [`OUTPUT_LIMIT`].
    pub truncated: bool,
}

/// Finds a program: a path (`~/bin/x`, `/usr/bin/x`, `bin/x` relative to
/// home) is resolved like any path argument; a bare name is looked up on
/// `PATH`. Returns an absolute path.
pub(crate) fn resolve_program(home: &Path, program: &str) -> Result<PathBuf> {
    if program.trim().is_empty() {
        return Err(XzError::InvalidArgs("`program` must not be empty".into()));
    }
    let is_path = program.starts_with('~') || program.contains(['/', '\\']);
    if is_path {
        let p = resolve(home, program);
        return if p.is_file() {
            Ok(p)
        } else {
            Err(XzError::NotFound(format!(
                "program `{program}` does not exist at {}",
                p.display()
            )))
        };
    }
    which::which(program).map_err(|_| {
        XzError::NotFound(format!(
            "program `{program}` was not found on PATH; give its full path instead"
        ))
    })
}

/// Runs `program` with `args` in `cwd`, killing it after `timeout`.
pub(crate) async fn run(
    program: &Path,
    args: &[String],
    cwd: &Path,
    timeout: Duration,
) -> Result<Finished> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: console programs must not flash a window.
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| XzError::Other(format!("could not start `{}`: {e}", program.display())))?;
    let out = Capture::start(child.stdout.take());
    let err = Capture::start(child.stderr.take());
    let (exit_code, timed_out) = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(status) => (status?.code(), false),
        Err(_) => {
            // `kill` also reaps the child, so no zombie is left behind.
            let _ = child.kill().await;
            (None, true)
        }
    };
    let (stdout, cut_out) = out.finish().await;
    let (stderr, cut_err) = err.finish().await;
    Ok(Finished {
        exit_code,
        stdout,
        stderr,
        timed_out,
        truncated: cut_out || cut_err,
    })
}

/// The tool output of a finished run: tainted by `source` (the program
/// printed it) and irreversible (the program may have done anything).
pub(crate) fn to_output(exe: &Path, args: &[String], f: Finished, source: String) -> ToolOutput {
    let note = format!("ran {} {}", exe.display(), args.join(" "));
    ToolOutput::tainted(
        json!({
            "program": exe,
            "args": args,
            "exit_code": f.exit_code,
            "stdout": f.stdout,
            "stderr": f.stderr,
            "timed_out": f.timed_out,
            "truncated": f.truncated
        }),
        source,
    )
    .with_effect(Effect::Irreversible {
        note: note.trim_end().to_string(),
    })
}

#[derive(Default)]
struct Captured {
    data: Vec<u8>,
    truncated: bool,
}

/// Reads one pipe into a bounded buffer, draining (and dropping) the rest
/// so the program never blocks on a full pipe.
struct Capture {
    buf: Arc<Mutex<Captured>>,
    task: Option<JoinHandle<()>>,
}

impl Capture {
    fn start<R: AsyncRead + Unpin + Send + 'static>(pipe: Option<R>) -> Self {
        let buf = Arc::new(Mutex::new(Captured::default()));
        let task = pipe.map(|mut r| {
            let buf = Arc::clone(&buf);
            tokio::spawn(async move {
                let mut chunk = [0u8; 8192];
                while let Ok(n @ 1..) = r.read(&mut chunk).await {
                    let mut b = buf.lock().unwrap_or_else(PoisonError::into_inner);
                    let room = OUTPUT_LIMIT - b.data.len();
                    if n > room {
                        b.truncated = true;
                    }
                    b.data.extend_from_slice(&chunk[..n.min(room)]);
                }
            })
        });
        Self { buf, task }
    }

    /// Waits briefly for the pipe to close, then returns what was read.
    async fn finish(mut self) -> (String, bool) {
        if let Some(task) = self.task.as_mut() {
            if tokio::time::timeout(DRAIN_GRACE, &mut *task).await.is_err() {
                task.abort();
            }
        }
        let b = std::mem::take(&mut *self.buf.lock().unwrap_or_else(PoisonError::into_inner));
        (String::from_utf8_lossy(&b.data).into_owned(), b.truncated)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn sh(script: &str) -> Vec<String> {
        vec!["-c".into(), script.into()]
    }

    #[tokio::test]
    async fn captures_output_and_exit_code() {
        let sh_path = resolve_program(Path::new("/"), "sh").unwrap();
        assert!(sh_path.is_absolute());
        let f = run(
            &sh_path,
            &sh("echo hi; echo err >&2; exit 3"),
            Path::new("/"),
            Duration::from_secs(10),
        )
        .await
        .unwrap();
        assert_eq!(f.stdout, "hi\n");
        assert_eq!(f.stderr, "err\n");
        assert_eq!(f.exit_code, Some(3));
        assert!(!f.timed_out && !f.truncated);
    }

    #[tokio::test]
    async fn kills_on_timeout() {
        let sh_path = resolve_program(Path::new("/"), "sh").unwrap();
        let start = std::time::Instant::now();
        let f = run(
            &sh_path,
            &sh("echo started; sleep 30"),
            Path::new("/"),
            Duration::from_millis(500),
        )
        .await
        .unwrap();
        assert!(f.timed_out);
        assert_eq!(f.exit_code, None);
        assert_eq!(f.stdout, "started\n");
        assert!(start.elapsed() < Duration::from_secs(10));
    }

    #[tokio::test]
    async fn truncates_large_output() {
        let sh_path = resolve_program(Path::new("/"), "sh").unwrap();
        let f = run(
            &sh_path,
            &sh("head -c 200000 /dev/zero | tr '\\0' a"),
            Path::new("/"),
            Duration::from_secs(20),
        )
        .await
        .unwrap();
        assert!(f.truncated);
        assert_eq!(f.stdout.len(), OUTPUT_LIMIT);
        assert_eq!(f.exit_code, Some(0));
    }

    #[test]
    fn resolves_programs() {
        let t = tempfile::tempdir().unwrap();
        assert!(matches!(
            resolve_program(t.path(), "definitely-not-a-program-xz"),
            Err(XzError::NotFound(_))
        ));
        assert!(matches!(
            resolve_program(t.path(), " "),
            Err(XzError::InvalidArgs(_))
        ));
        std::fs::write(t.path().join("tool"), "").unwrap();
        assert_eq!(
            resolve_program(t.path(), "~/tool").unwrap(),
            t.path().join("tool")
        );
        assert!(resolve_program(t.path(), "./missing").is_err());
    }
}
