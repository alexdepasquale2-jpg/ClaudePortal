//! Mounts a third-party MCP server, spoken to over stdio, as an Organ
//! (SPEC §3.2).
//!
//! Its tools appear as `<server>.<tool>` with `first_party = false`, so
//! the Warden treats every one as `commit` whatever the server claims
//! about itself, and their output is tainted: the server is outside the
//! user's control.

use async_trait::async_trait;
use rmcp::model::{CallToolRequestParams, ContentBlock, Tool};
use rmcp::service::RunningService;
use rmcp::transport::TokioChildProcess;
use rmcp::{RoleClient, ServiceExt};
use serde_json::{Map, Value};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use xz_types::{CallCtx, Effect, Organ, Result, Risk, ToolOutput, ToolSpec, XzError};

use crate::spawn::resolve_program;

/// Names a server may not take: core families and core tool prefixes.
const RESERVED: &[&str] = &[
    "fs", "proc", "net", "clip", "notify", "media", "voice", "people", "ui", "engram", "sys",
    "sensor", "power", "hive", "xz", "ancestor",
];

/// Time allowed for start-up: the handshake plus the tool listing.
const START_TIMEOUT: Duration = Duration::from_secs(30);

/// Time allowed for one tool call.
const CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// A running MCP server and the tools it offered at mount time.
pub struct McpMount {
    server: String,
    tools: Vec<ToolSpec>,
    client: RunningService<RoleClient, ()>,
}

impl McpMount {
    /// Starts `program` with `args` (working directory `home`), performs
    /// the MCP handshake and lists the server's tools. `server` becomes the
    /// tool prefix: lowercase letters, digits, `_` and `-`.
    pub async fn spawn(server: &str, program: &str, args: &[String], home: &Path) -> Result<Self> {
        check_server_name(server)?;
        let exe = resolve_program(home, program)?;
        let mut cmd = tokio::process::Command::new(&exe);
        cmd.args(args).current_dir(home);
        #[cfg(windows)]
        {
            // CREATE_NO_WINDOW: a console server must not flash a window.
            cmd.creation_flags(0x0800_0000);
        }
        let (transport, stderr) = TokioChildProcess::builder(cmd)
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| XzError::Other(format!("could not start MCP server `{server}`: {e}")))?;
        if let Some(stderr) = stderr {
            forward_logs(server.to_owned(), stderr);
        }
        let started = tokio::time::timeout(START_TIMEOUT, async {
            let client = ().serve(transport).await.map_err(|e| {
                XzError::Other(format!("MCP server `{server}` failed the handshake: {e}"))
            })?;
            let tools = client.list_all_tools().await.map_err(|e| {
                XzError::Other(format!("MCP server `{server}` did not list its tools: {e}"))
            })?;
            Ok::<_, XzError>((client, tools))
        })
        .await
        .map_err(|_| {
            XzError::Other(format!(
                "MCP server `{server}` did not start within {} s",
                START_TIMEOUT.as_secs()
            ))
        })??;
        let (client, listed) = started;
        Ok(Self {
            tools: listed.iter().map(|t| spec(server, t)).collect(),
            server: server.to_owned(),
            client,
        })
    }

    /// The tool prefix, e.g. `github` for `github.create_issue`.
    pub fn server(&self) -> &str {
        &self.server
    }

    /// Ends the session and stops the server process.
    pub async fn close(mut self) {
        let _ = self.client.close().await;
    }
}

fn check_server_name(server: &str) -> Result<()> {
    let well_formed = server
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_lowercase())
        && server.len() <= 64
        && server
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
    if !well_formed {
        return Err(XzError::InvalidArgs(format!(
            "MCP server name `{server}` must start with a lowercase letter and use only \
             lowercase letters, digits, `_` and `-`"
        )));
    }
    if RESERVED.contains(&server) {
        return Err(XzError::InvalidArgs(format!(
            "MCP server name `{server}` is reserved for a core Organ"
        )));
    }
    Ok(())
}

/// A third-party tool as Xindoze sees it: never trusted, always commit.
fn spec(server: &str, t: &Tool) -> ToolSpec {
    ToolSpec {
        name: format!("{server}.{}", t.name),
        description: t
            .description
            .as_deref()
            .map(str::to_owned)
            .or_else(|| t.title.clone())
            .unwrap_or_default(),
        input_schema: Value::Object((*t.input_schema).clone()),
        // The server's annotations are hints from an untrusted party.
        risk: Risk::Commit,
        resource_args: vec![],
        tainted_output: true,
        first_party: false,
    }
}

/// Sends the server's stderr to the log instead of the daemon's terminal.
fn forward_logs(server: String, stderr: tokio::process::ChildStderr) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::debug!(target: "xz_bridge::mcp", %server, "{line}");
        }
    });
}

/// The text of a result's content blocks; other kinds are named, not
/// inlined.
fn text_of(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .map(|b| {
            let v = serde_json::to_value(b).unwrap_or(Value::Null);
            match (v["type"].as_str(), v["text"].as_str()) {
                (Some("text"), Some(text)) => text.to_owned(),
                (kind, _) => format!("[{} content omitted]", kind.unwrap_or("unknown")),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[async_trait]
impl Organ for McpMount {
    fn family(&self) -> &str {
        &self.server
    }

    fn tools(&self) -> Vec<ToolSpec> {
        self.tools.clone()
    }

    async fn call(&self, _ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        if !self.tools.iter().any(|t| t.name == tool) {
            return Err(XzError::UnknownTool(tool.into()));
        }
        let name = &tool[self.server.len() + 1..];
        let arguments = match args {
            Value::Null => Map::new(),
            Value::Object(m) => m,
            _ => {
                return Err(XzError::InvalidArgs(format!(
                    "{tool}: arguments must be a JSON object"
                )));
            }
        };
        let params = CallToolRequestParams::new(name.to_owned()).with_arguments(arguments);
        let result = tokio::time::timeout(CALL_TIMEOUT, self.client.call_tool(params))
            .await
            .map_err(|_| {
                XzError::Other(format!(
                    "{tool} did not answer within {} s",
                    CALL_TIMEOUT.as_secs()
                ))
            })?
            .map_err(|e| XzError::Other(format!("{tool}: {e}")))?;
        let text = text_of(&result.content);
        if result.is_error == Some(true) {
            return Err(XzError::Other(format!("{tool} failed: {text}")));
        }
        let content = result.structured_content.unwrap_or(Value::String(text));
        Ok(
            ToolOutput::tainted(content, format!("mcp:{}", self.server)).with_effect(
                Effect::Irreversible {
                    note: format!("called third-party tool {tool}"),
                },
            ),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A tiny MCP server speaking newline-delimited JSON-RPC on stdio.
    const SERVER: &str = r#"
import json, sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    if "id" not in msg or "method" not in msg:
        continue
    method, params = msg["method"], msg.get("params") or {}
    if method == "initialize":
        result = {"protocolVersion": params.get("protocolVersion"),
                  "capabilities": {"tools": {}},
                  "serverInfo": {"name": "demo", "version": "0.1.0"}}
    elif method == "tools/list":
        result = {"tools": [
            {"name": "echo", "description": "Echo text back",
             "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}},
                             "required": ["text"]},
             "annotations": {"readOnlyHint": True}},
            {"name": "fail", "inputSchema": {"type": "object"}}]}
    elif method == "tools/call":
        if params["name"] == "echo":
            result = {"content": [{"type": "text", "text": "echo: " + params["arguments"]["text"]}]}
        else:
            result = {"content": [{"type": "text", "text": "boom"}], "isError": True}
    elif method == "ping":
        result = {}
    else:
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"],
                          "error": {"code": -32601, "message": "no such method"}}), flush=True)
        continue
    print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}), flush=True)
"#;

    fn python() -> Option<std::path::PathBuf> {
        which::which("python3")
            .or_else(|_| which::which("python"))
            .ok()
    }

    #[test]
    fn server_names() {
        assert!(check_server_name("github").is_ok());
        assert!(check_server_name("my-server_2").is_ok());
        for bad in ["", "GitHub", "1x", "a.b", "a b", "fs", "xz", "engram"] {
            assert!(check_server_name(bad).is_err(), "{bad}");
        }
    }

    #[tokio::test]
    async fn mounts_and_calls_a_server() {
        let Some(py) = python() else {
            eprintln!("skipped: no python on PATH for the test MCP server");
            return;
        };
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("server.py"), SERVER).unwrap();
        let args = vec!["-u".to_string(), "server.py".to_string()];
        let mount = McpMount::spawn("demo", py.to_str().unwrap(), &args, t.path())
            .await
            .unwrap();
        assert_eq!(mount.family(), "demo");
        assert_eq!(mount.server(), "demo");
        let tools = mount.tools();
        let names: Vec<_> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["demo.echo", "demo.fail"]);
        for t in &tools {
            assert!(!t.first_party && t.tainted_output);
            assert_eq!(t.effective_risk(), Risk::Commit);
        }
        assert_eq!(tools[0].description, "Echo text back");
        assert_eq!(tools[0].input_schema["required"], json!(["text"]));

        let ctx = CallCtx::test();
        let out = mount
            .call(&ctx, "demo.echo", json!({"text": "hi"}))
            .await
            .unwrap();
        assert_eq!(out.content, "echo: hi");
        assert!(out.taint.sources.contains("mcp:demo"));
        assert!(matches!(&out.effects[..], [Effect::Irreversible { .. }]));

        let e = mount.call(&ctx, "demo.fail", json!({})).await.unwrap_err();
        assert!(e.to_string().contains("boom"), "{e}");
        for tool in ["demo.nope", "other.echo", "demo"] {
            assert!(matches!(
                mount.call(&ctx, tool, json!({})).await,
                Err(XzError::UnknownTool(_))
            ));
        }
        assert!(matches!(
            mount.call(&ctx, "demo.echo", json!(["hi"])).await,
            Err(XzError::InvalidArgs(_))
        ));
        mount.close().await;
    }

    #[tokio::test]
    async fn failing_servers_are_errors() {
        let t = tempfile::tempdir().unwrap();
        assert!(matches!(
            McpMount::spawn("demo", "no-such-mcp-server-xz", &[], t.path()).await,
            Err(XzError::NotFound(_))
        ));
        assert!(matches!(
            McpMount::spawn("fs", "sh", &[], t.path()).await,
            Err(XzError::InvalidArgs(_))
        ));
        if cfg!(unix) {
            // Exits at once: the handshake fails instead of hanging.
            let r = McpMount::spawn("demo", "sh", &["-c".into(), "exit 0".into()], t.path()).await;
            assert!(r.is_err());
        }
    }
}
