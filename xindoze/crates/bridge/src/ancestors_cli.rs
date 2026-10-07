//! CLI Ancestors (SPEC §3.13): a legacy command-line program becomes the
//! tool `ancestor.<name>`, described by its own `--help` text.
//!
//! Running an Ancestor is always `commit`. The schema is deliberately
//! plain (`{args: [string]}`); model-assisted refinement comes later.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{PoisonError, RwLock};
use std::time::Duration;
use xz_types::{CallCtx, Organ, Result, Risk, ToolOutput, ToolSpec, XzError};

use crate::spawn::{resolve_program, run, to_output};
use crate::util::{blocking, parse_args, truncate};

/// How long `<program> --help` may take.
pub const HELP_TIMEOUT: Duration = Duration::from_secs(5);

/// How long one Ancestor run may take.
const RUN_TIMEOUT: Duration = Duration::from_secs(60);

/// Longest tool description kept from the help text, in bytes.
const DESCRIPTION_MAX: usize = 4000;

/// A program adopted as a tool.
#[derive(Clone, Debug, PartialEq)]
pub struct Ancestor {
    pub spec: ToolSpec,
    /// Absolute path of the program.
    pub program: PathBuf,
}

/// Runs `<program> --help` (in `home`, at most [`HELP_TIMEOUT`]) and turns
/// what it prints into the spec of `ancestor.<name>`.
pub async fn describe(home: &Path, program: &str) -> Result<Ancestor> {
    describe_within(home, program, HELP_TIMEOUT).await
}

async fn describe_within(home: &Path, program: &str, timeout: Duration) -> Result<Ancestor> {
    let (h, p) = (home.to_path_buf(), program.to_owned());
    let exe = blocking(move || resolve_program(&h, &p)).await?;
    let name = tool_name(&exe)?;
    let f = run(&exe, &["--help".to_string()], home, timeout).await?;
    let printed = if f.stdout.trim().is_empty() {
        &f.stderr
    } else {
        &f.stdout
    };
    let help = strip_terminal_codes(printed);
    if help.trim().is_empty() {
        return Err(XzError::InvalidArgs(format!(
            "`{program}` printed no help for --help{}; it cannot be described automatically",
            if f.timed_out {
                " before timing out"
            } else {
                ""
            }
        )));
    }
    let mut description = format!(
        "Runs the program {} with the given arguments. Its --help says:\n{}",
        exe.display(),
        help.trim()
    );
    truncate(&mut description, DESCRIPTION_MAX);
    let spec = ToolSpec {
        name: format!("ancestor.{name}"),
        description,
        input_schema: json!({
            "type": "object",
            "properties": {
                "args": {"type": "array", "items": {"type": "string"}, "default": [],
                         "description": "Command-line arguments, one per item."}
            },
            "additionalProperties": false
        }),
        risk: Risk::Commit,
        resource_args: vec![],
        tainted_output: true,
        first_party: true,
    };
    Ok(Ancestor { spec, program: exe })
}

/// `ancestor.<name>` from the program's file name: lowercase, with
/// anything outside `[a-z0-9_-]` replaced so the name stays one segment.
fn tool_name(exe: &Path) -> Result<String> {
    let stem = exe
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let name: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if name.trim_matches('_').is_empty() {
        return Err(XzError::InvalidArgs(format!(
            "cannot name a tool after `{}`",
            exe.display()
        )));
    }
    Ok(name)
}

/// Drops ANSI escape sequences, applies backspace overstrikes and removes
/// other control characters: help text is often colored or bolded.
fn strip_terminal_codes(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        match c {
            '\u{1b}' => {
                // CSI sequences end at a byte in `@..=~`; others are two bytes.
                if chars.next() == Some('[') {
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
            }
            '\u{8}' => {
                out.pop();
            }
            '\n' | '\t' => out.push(c),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// Serves the adopted `ancestor.*` tools.
#[derive(Debug)]
pub struct AncestorOrgan {
    home: PathBuf,
    adopted: RwLock<BTreeMap<String, Ancestor>>,
}

impl AncestorOrgan {
    /// Ancestors run with `home` as their working directory.
    pub fn new(home: PathBuf) -> Self {
        Self {
            home,
            adopted: RwLock::default(),
        }
    }

    /// Describes `program` and serves it from now on, replacing an earlier
    /// adoption of the same name. Returns its spec.
    pub async fn adopt(&self, program: &str) -> Result<ToolSpec> {
        let a = describe(&self.home, program).await?;
        let spec = a.spec.clone();
        self.adopted
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(spec.name.clone(), a);
        Ok(spec)
    }

    fn get(&self, tool: &str) -> Option<Ancestor> {
        self.adopted
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .get(tool)
            .cloned()
    }
}

#[async_trait]
impl Organ for AncestorOrgan {
    fn family(&self) -> &str {
        "ancestor"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        self.adopted
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
            .map(|a| a.spec.clone())
            .collect()
    }

    async fn call(&self, _ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct A {
            #[serde(default)]
            args: Vec<String>,
        }
        let ancestor = self
            .get(tool)
            .ok_or_else(|| XzError::UnknownTool(tool.into()))?;
        let a: A = parse_args(tool, args)?;
        let f = run(&ancestor.program, &a.args, &self.home, RUN_TIMEOUT).await?;
        let name = tool.trim_start_matches("ancestor.");
        Ok(to_output(
            &ancestor.program,
            &a.args,
            f,
            format!("proc:{name}"),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_terminal_codes() {
        assert_eq!(
            strip_terminal_codes("\u{1b}[1mUsage\u{1b}[0m: x"),
            "Usage: x"
        );
        assert_eq!(
            strip_terminal_codes("N\u{8}NA\u{8}AME\r\n\tx\u{7}"),
            "NAME\n\tx"
        );
        assert_eq!(strip_terminal_codes("_\u{8}u"), "u");
    }

    #[test]
    fn names_tools_after_the_program() {
        assert_eq!(tool_name(Path::new("/usr/bin/git")).unwrap(), "git");
        assert_eq!(tool_name(Path::new("/opt/Tool.v2.exe")).unwrap(), "tool_v2");
        assert!(tool_name(Path::new("/x/...")).is_err());
    }

    #[cfg(unix)]
    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let p = dir.join(name);
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn adopts_and_runs_a_cli() {
        let t = tempfile::tempdir().unwrap();
        let home = t.path();
        script(
            home,
            "mytool",
            r#"if [ "$1" = "--help" ]; then printf '\033[1mUsage\033[0m: mytool [-v] FILE\n'; exit 0; fi
echo "ran with $*""#,
        );
        let organ = AncestorOrgan::new(home.to_path_buf());
        let spec = organ.adopt("~/mytool").await.unwrap();
        assert_eq!(spec.name, "ancestor.mytool");
        assert_eq!(spec.risk, Risk::Commit);
        assert_eq!(spec.effective_risk(), Risk::Commit);
        assert!(
            spec.description.contains("Usage: mytool [-v] FILE"),
            "{}",
            spec.description
        );
        assert_eq!(spec.input_schema["properties"]["args"]["type"], "array");
        assert_eq!(organ.tools(), vec![spec]);

        let out = organ
            .call(
                &CallCtx::test(),
                "ancestor.mytool",
                json!({"args": ["a", "b c"]}),
            )
            .await
            .unwrap();
        assert_eq!(out.content["stdout"], "ran with a b c\n");
        assert!(out.taint.sources.contains("proc:mytool"));
        assert!(matches!(
            &out.effects[..],
            [xz_types::Effect::Irreversible { .. }]
        ));

        let e = organ
            .call(&CallCtx::test(), "ancestor.other", json!({}))
            .await
            .unwrap_err();
        assert!(matches!(e, XzError::UnknownTool(_)));
        let e = organ
            .call(&CallCtx::test(), "ancestor.mytool", json!({"args": "a b"}))
            .await
            .unwrap_err();
        assert!(matches!(e, XzError::InvalidArgs(_)));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn help_on_stderr_silence_and_timeouts() {
        let t = tempfile::tempdir().unwrap();
        let home = t.path();
        script(home, "errhelp", "echo 'usage: errhelp NAME' >&2; exit 1");
        let a = describe(home, "~/errhelp").await.unwrap();
        assert!(a.spec.description.contains("usage: errhelp NAME"));
        assert_eq!(a.program, home.join("errhelp"));

        script(home, "silent", "exit 0");
        let e = describe(home, "~/silent").await.unwrap_err();
        assert!(matches!(e, XzError::InvalidArgs(_)), "{e}");

        script(home, "slow", "sleep 30");
        let start = std::time::Instant::now();
        let e = describe_within(home, "~/slow", Duration::from_millis(300))
            .await
            .unwrap_err();
        assert!(e.to_string().contains("timing out"), "{e}");
        assert!(start.elapsed() < Duration::from_secs(10));

        assert!(matches!(
            describe(home, "no-such-program-xz").await,
            Err(XzError::NotFound(_))
        ));
    }
}
