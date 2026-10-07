//! Text-to-speech engines run as separate processes: espeak-ng, espeak, piper.
//!
//! Running them as programs (not linking them) keeps GPL code out of the
//! runtime and avoids system libraries at build time.

use super::Speaker;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use xz_types::XzError;

/// A speaker backed by an external TTS program.
#[derive(Clone, Debug)]
pub struct ProcessSpeaker {
    name: String,
    kind: Kind,
}

#[derive(Clone, Debug)]
enum Kind {
    /// espeak or espeak-ng: plays the audio itself.
    Espeak { program: PathBuf },
    /// piper writes a WAV file, which a player then plays.
    Piper {
        program: PathBuf,
        voice: PathBuf,
        player: PathBuf,
    },
}

impl ProcessSpeaker {
    /// An espeak-compatible program (`espeak-ng` or `espeak`).
    pub fn espeak(name: impl Into<String>, program: impl Into<PathBuf>) -> Self {
        Self {
            name: name.into(),
            kind: Kind::Espeak {
                program: program.into(),
            },
        }
    }

    /// piper with a voice model, played through `player` (e.g. `aplay`).
    pub fn piper(
        program: impl Into<PathBuf>,
        voice: impl Into<PathBuf>,
        player: impl Into<PathBuf>,
    ) -> Self {
        Self {
            name: "piper".into(),
            kind: Kind::Piper {
                program: program.into(),
                voice: voice.into(),
                player: player.into(),
            },
        }
    }
}

impl Speaker for ProcessSpeaker {
    fn name(&self) -> &str {
        &self.name
    }

    fn speak(&self, text: &str) -> Result<(), XzError> {
        let timeout = speak_timeout(text);
        match &self.kind {
            // Text goes in on stdin so it can never be read as a command-line option.
            Kind::Espeak { program } => run(Command::new(program).arg("--stdin"), text, timeout),
            Kind::Piper {
                program,
                voice,
                player,
            } => {
                let wav = tempfile::Builder::new().suffix(".wav").tempfile()?;
                run(
                    Command::new(program)
                        .arg("-m")
                        .arg(voice)
                        .arg("-f")
                        .arg(wav.path()),
                    text,
                    timeout,
                )?;
                run(Command::new(player).arg(wav.path()), "", timeout)
            }
        }
    }
}

/// Upper bound for one utterance. Speech runs at roughly 15 characters a
/// second, so this only trips when an engine hangs.
fn speak_timeout(text: &str) -> Duration {
    Duration::from_secs(30 + text.chars().count() as u64 / 5)
}

/// Runs `cmd` with `input` on stdin and waits for it, killing it after `timeout`.
pub(crate) fn run(cmd: &mut Command, input: &str, timeout: Duration) -> Result<(), XzError> {
    let program = cmd.get_program().to_string_lossy().into_owned();
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| XzError::Other(format!("cannot start {program}: {e}")))?;
    // Dropping stdin after the write closes the pipe, which ends the input.
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(input.as_bytes()) {
            stop(&mut child);
            return Err(XzError::Other(format!(
                "{program}: writing text failed: {e}"
            )));
        }
    }
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            return if status.success() {
                Ok(())
            } else {
                Err(XzError::Other(format!("{program} failed: {status}")))
            };
        }
        if Instant::now() >= deadline {
            stop(&mut child);
            return Err(XzError::Other(format!(
                "{program} did not finish within {}s",
                timeout.as_secs()
            )));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Finds an executable on PATH (adding `.exe` on Windows).
pub fn find_program(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        let candidate = dir.join(name);
        if cfg!(windows) {
            let exe = candidate.with_extension("exe");
            if exe.is_file() {
                return Some(exe);
            }
        }
        is_executable(&candidate).then_some(candidate)
    })
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(p: &Path) -> bool {
    p.is_file()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// Writes an executable shell script into `dir`.
    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn espeak_gets_text_on_stdin() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out.txt");
        let fake = script(
            dir.path(),
            "espeak-ng",
            &format!("echo \"$@\" > '{0}.args'\ncat > '{0}'", out.display()),
        );
        let speaker = ProcessSpeaker::espeak("espeak-ng", fake);
        speaker.speak("--help me; rm -rf /").unwrap();
        assert_eq!(
            std::fs::read_to_string(&out).unwrap(),
            "--help me; rm -rf /"
        );
        let args = std::fs::read_to_string(dir.path().join("out.txt.args")).unwrap();
        assert_eq!(args.trim(), "--stdin");
        assert_eq!(speaker.name(), "espeak-ng");
    }

    #[test]
    fn piper_renders_then_plays() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("log.txt");
        // Fake piper: `-m VOICE -f OUT`; writes the text it was given into OUT.
        let piper = script(dir.path(), "piper", "cat > \"$4\"");
        let player = script(
            dir.path(),
            "aplay",
            &format!("cat \"$1\" > '{}'", log.display()),
        );
        let speaker = ProcessSpeaker::piper(piper, dir.path().join("voice.onnx"), player);
        speaker.speak("hello piper").unwrap();
        assert_eq!(std::fs::read_to_string(&log).unwrap(), "hello piper");
    }

    #[test]
    fn failing_engine_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let fake = script(dir.path(), "espeak", "cat >/dev/null; exit 3");
        let err = ProcessSpeaker::espeak("espeak", fake)
            .speak("hi")
            .unwrap_err();
        assert!(err.to_string().contains("failed"), "{err}");
        let err = ProcessSpeaker::espeak("espeak", dir.path().join("missing"))
            .speak("hi")
            .unwrap_err();
        assert!(err.to_string().contains("cannot start"), "{err}");
    }

    #[test]
    fn hung_engine_is_killed() {
        let dir = tempfile::tempdir().unwrap();
        let fake = script(dir.path(), "slow", "sleep 10");
        let start = Instant::now();
        let err = run(&mut Command::new(fake), "", Duration::from_millis(200)).unwrap_err();
        assert!(err.to_string().contains("did not finish"), "{err}");
        assert!(start.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn finds_programs_on_path() {
        assert!(find_program("sh").is_some());
        assert!(find_program("definitely-not-a-program-xz").is_none());
    }

    #[test]
    fn timeout_grows_with_text() {
        assert_eq!(speak_timeout(""), Duration::from_secs(30));
        assert!(speak_timeout(&"a".repeat(10_000)) > Duration::from_secs(600));
    }
}
