//! The `proc` Organ: processes and default apps (SPEC Appendix D).

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, System};
use xz_types::Risk::{Act, Commit, Observe};
use xz_types::{CallCtx, Effect, Organ, Result, ToolOutput, ToolSpec, XzError};

use crate::paths::Roots;
use crate::spawn::{resolve_program, run, to_output};
use crate::util::{Empty, blocking, in_range, parse_args, tool};

/// Extensions `proc.open` refuses: opening them would run code.
const EXECUTABLE: &[&str] = &[
    "exe", "bat", "cmd", "ps1", "sh", "msi", "lnk", "vbs", "js", "jar", "apk", "desktop", "scr",
    "com", "app", "command",
];

/// Processes `proc.list` returns, largest memory first.
const LIST_MAX: usize = 200;

/// Serves `proc.*`.
#[derive(Clone, Debug)]
pub struct ProcOrgan {
    roots: Roots,
    can_open: bool,
}

impl ProcOrgan {
    /// `home` is the working directory of spawned programs and anchors
    /// relative paths. `proc.open` uses the desktop's default apps where
    /// this build has them.
    pub fn new(home: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            roots: Roots::new(home, data_dir),
            can_open: cfg!(any(windows, target_os = "macos", target_os = "linux")),
        }
    }

    /// Disables `proc.open` (it then returns `Unsupported`), for hosts
    /// whose shell opens files itself, such as Android intents.
    pub fn without_open(mut self) -> Self {
        self.can_open = false;
        self
    }

    async fn spawn(&self, args: Value) -> Result<ToolOutput> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct A {
            program: String,
            #[serde(default)]
            args: Vec<String>,
            timeout_s: Option<u64>,
        }
        let a: A = parse_args("proc.spawn", args)?;
        let timeout = in_range(
            "proc.spawn",
            "timeout_s",
            a.timeout_s.unwrap_or(60),
            1,
            3600,
        )?;
        let home = self.roots.home.clone();
        let program = a.program.clone();
        let exe = blocking(move || resolve_program(&home, &program)).await?;
        let f = run(
            &exe,
            &a.args,
            &self.roots.home,
            Duration::from_secs(timeout),
        )
        .await?;
        Ok(to_output(&exe, &a.args, f, format!("proc:{}", a.program)))
    }

    fn open(&self, args: Value) -> Result<ToolOutput> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct A {
            path: String,
        }
        let a: A = parse_args("proc.open", args)?;
        let p = self.roots.resolve_real("path", &a.path)?;
        if is_executable(&p) {
            return Err(XzError::InvalidArgs(format!(
                "`{}` is a program or script; proc.open only opens documents, folders and \
                 media. To run a program use proc.spawn, which asks the user first",
                p.display()
            )));
        }
        if std::fs::symlink_metadata(&p).is_err() {
            return Err(XzError::NotFound(format!(
                "`{}` does not exist",
                p.display()
            )));
        }
        if !self.can_open {
            return Err(XzError::Unsupported(
                "proc.open: this host cannot open files with a default app".into(),
            ));
        }
        open_with_default_app(&p)?;
        Ok(ToolOutput::clean(json!({"opened": p})))
    }
}

fn is_executable(p: &Path) -> bool {
    p.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .is_some_and(|e| EXECUTABLE.contains(&e.as_str()))
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
fn open_with_default_app(p: &Path) -> Result<()> {
    open::that_detached(p)
        .map_err(|e| XzError::Other(format!("could not open {}: {e}", p.display())))
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn open_with_default_app(_p: &Path) -> Result<()> {
    Err(XzError::Unsupported(
        "proc.open is not available on this platform".into(),
    ))
}

fn list() -> Result<ToolOutput> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut procs: Vec<_> = sys.processes().values().collect();
    procs.sort_by_key(|p| (std::cmp::Reverse(p.memory()), p.pid().as_u32()));
    let shown: Vec<Value> = procs
        .iter()
        .take(LIST_MAX)
        .map(|p| {
            json!({
                "pid": p.pid().as_u32(),
                "name": p.name().to_string_lossy(),
                "memory_mb": p.memory() / (1024 * 1024)
            })
        })
        .collect();
    Ok(ToolOutput::clean(
        json!({"processes": shown, "total": procs.len()}),
    ))
}

fn kill(args: Value) -> Result<ToolOutput> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct A {
        pid: u32,
    }
    let a: A = parse_args("proc.kill", args)?;
    if a.pid == std::process::id() {
        return Err(XzError::InvalidArgs(
            "proc.kill: refusing to kill Xindoze itself".into(),
        ));
    }
    let pid = Pid::from_u32(a.pid);
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    let p = sys
        .process(pid)
        .ok_or_else(|| XzError::NotFound(format!("no process with pid {}", a.pid)))?;
    let name = p.name().to_string_lossy().into_owned();
    if !p.kill() {
        return Err(XzError::Other(format!(
            "could not kill {name} (pid {}); it may belong to another user",
            a.pid
        )));
    }
    Ok(
        ToolOutput::clean(json!({"pid": a.pid, "name": name, "killed": true})).with_effect(
            Effect::Irreversible {
                note: format!("killed {name} (pid {})", a.pid),
            },
        ),
    )
}

fn specs() -> Vec<ToolSpec> {
    vec![
        tool(
            "proc.list",
            "List running processes (largest memory first, at most 200): pid, name, memory_mb.",
            Observe,
            json!({"type": "object", "properties": {}, "additionalProperties": false}),
            &[],
            false,
        ),
        tool(
            "proc.open",
            "Open a document, folder or media file with the user's default app. Refuses \
             programs and scripts; use proc.spawn for those.",
            Act,
            json!({
                "type": "object",
                "properties": {"path": {"type": "string",
                    "description": "File or folder; `~` is home, relative paths are relative to it."}},
                "required": ["path"],
                "additionalProperties": false
            }),
            &["path"],
            false,
        ),
        tool(
            "proc.spawn",
            "Run a program (a name on PATH or a full path) with arguments, in the home folder, \
             and return its exit code and output (each stream cut at 64 KB). Killed after \
             timeout_s seconds.",
            Commit,
            json!({
                "type": "object",
                "properties": {
                    "program": {"type": "string"},
                    "args": {"type": "array", "items": {"type": "string"}, "default": []},
                    "timeout_s": {"type": "integer", "minimum": 1, "maximum": 3600, "default": 60}
                },
                "required": ["program"],
                "additionalProperties": false
            }),
            &[],
            true,
        ),
        tool(
            "proc.kill",
            "Stop a running process by pid (see proc.list).",
            Commit,
            json!({
                "type": "object",
                "properties": {"pid": {"type": "integer", "minimum": 0}},
                "required": ["pid"],
                "additionalProperties": false
            }),
            &[],
            false,
        ),
    ]
}

#[async_trait]
impl Organ for ProcOrgan {
    fn family(&self) -> &str {
        "proc"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        specs()
    }

    async fn call(&self, _ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        match tool {
            "proc.list" => {
                parse_args::<Empty>("proc.list", args)?;
                blocking(list).await
            }
            "proc.open" => {
                let me = self.clone();
                blocking(move || me.open(args)).await
            }
            "proc.spawn" => self.spawn(args).await,
            "proc.kill" => blocking(move || kill(args)).await,
            _ => Err(XzError::UnknownTool(tool.into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::Sandbox;

    fn organ(s: &Sandbox) -> ProcOrgan {
        ProcOrgan::new(s.home.clone(), s.data.clone())
    }

    #[test]
    fn specs_match_the_catalog() {
        let s = Sandbox::new();
        let t = organ(&s).tools();
        let find = |n: &str| t.iter().find(|x| x.name == n).unwrap();
        assert_eq!(find("proc.list").risk, Observe);
        assert_eq!(find("proc.open").risk, Act);
        assert_eq!(find("proc.open").resource_args, ["path"]);
        assert_eq!(find("proc.spawn").risk, Commit);
        assert!(find("proc.spawn").resource_args.is_empty());
        assert!(find("proc.spawn").tainted_output);
        assert_eq!(find("proc.kill").risk, Commit);
    }

    #[tokio::test]
    async fn open_refuses_executables() {
        let s = Sandbox::new();
        for name in ["setup.EXE", "run.sh", "x.desktop", "Tool.app", "a.Ps1"] {
            s.put(name, "");
            let e = organ(&s)
                .call(&s.ctx(), "proc.open", json!({"path": format!("~/{name}")}))
                .await
                .unwrap_err();
            assert!(matches!(e, XzError::InvalidArgs(_)), "{name}");
            assert!(e.to_string().contains("proc.spawn"), "{e}");
        }
        let e = organ(&s)
            .call(&s.ctx(), "proc.open", json!({"path": "~/missing.pdf"}))
            .await
            .unwrap_err();
        assert!(matches!(e, XzError::NotFound(_)));
        s.put("doc.pdf", "");
        let e = organ(&s)
            .without_open()
            .call(&s.ctx(), "proc.open", json!({"path": "~/doc.pdf"}))
            .await
            .unwrap_err();
        assert!(matches!(e, XzError::Unsupported(_)));
    }

    #[tokio::test]
    async fn list_shows_this_process() {
        let s = Sandbox::new();
        let out = organ(&s)
            .call(&s.ctx(), "proc.list", json!({}))
            .await
            .unwrap();
        assert!(out.content["total"].as_u64().unwrap() >= 1);
        assert!(!out.content["processes"].as_array().unwrap().is_empty());
        assert!(
            organ(&s)
                .call(&s.ctx(), "proc.list", json!({"x": 1}))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn kill_refuses_self_and_unknown() {
        let s = Sandbox::new();
        let me = std::process::id();
        let e = organ(&s)
            .call(&s.ctx(), "proc.kill", json!({"pid": me}))
            .await
            .unwrap_err();
        assert!(matches!(e, XzError::InvalidArgs(_)));
        let e = organ(&s)
            .call(&s.ctx(), "proc.kill", json!({"pid": u32::MAX - 7}))
            .await
            .unwrap_err();
        assert!(matches!(e, XzError::NotFound(_)));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn spawn_runs_kills_and_truncates() {
        let s = Sandbox::new();
        let o = organ(&s);
        let out = o
            .call(
                &s.ctx(),
                "proc.spawn",
                json!({"program": "sh", "args": ["-c", "pwd; echo hi"]}),
            )
            .await
            .unwrap();
        let program = out.content["program"].as_str().unwrap();
        assert!(Path::new(program).is_absolute());
        assert!(out.content["stdout"].as_str().unwrap().ends_with("hi\n"));
        assert!(
            out.content["stdout"]
                .as_str()
                .unwrap()
                .starts_with(s.home.to_str().unwrap())
        );
        assert_eq!(out.content["exit_code"], 0);
        assert!(out.taint.sources.contains("proc:sh"));
        match &out.effects[..] {
            [Effect::Irreversible { note }] => assert!(note.contains(program), "{note}"),
            other => panic!("{other:?}"),
        }

        let out = o
            .call(
                &s.ctx(),
                "proc.spawn",
                json!({"program": "sh", "args": ["-c", "sleep 30"], "timeout_s": 1}),
            )
            .await
            .unwrap();
        assert_eq!(out.content["timed_out"], true);
        assert_eq!(out.content["exit_code"], Value::Null);

        let out = o
            .call(
                &s.ctx(),
                "proc.spawn",
                json!({"program": "sh", "args": ["-c", "head -c 100000 /dev/zero | tr '\\0' x"]}),
            )
            .await
            .unwrap();
        assert_eq!(out.content["truncated"], true);
        assert_eq!(out.content["stdout"].as_str().unwrap().len(), 64 * 1024);

        let e = o
            .call(
                &s.ctx(),
                "proc.spawn",
                json!({"program": "no-such-program-xz"}),
            )
            .await
            .unwrap_err();
        assert!(matches!(e, XzError::NotFound(_)));
        let e = o
            .call(
                &s.ctx(),
                "proc.spawn",
                json!({"program": "sh", "timeout_s": 0}),
            )
            .await
            .unwrap_err();
        assert!(matches!(e, XzError::InvalidArgs(_)));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn spawn_runs_on_windows() {
        let s = Sandbox::new();
        let out = organ(&s)
            .call(
                &s.ctx(),
                "proc.spawn",
                json!({"program": "cmd", "args": ["/C", "echo hi"]}),
            )
            .await
            .unwrap();
        assert!(out.content["stdout"].as_str().unwrap().contains("hi"));
    }
}
