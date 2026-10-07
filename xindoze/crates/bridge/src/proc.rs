//! `proc.list` (SPEC Appendix D). `spawn` and `kill` are commit-level and
//! TODO(phase 1). Spawn output would be tainted.

use async_trait::async_trait;
use serde_json::{Value, json};
use xz_types::{CallCtx, Organ, Result, Risk, ToolOutput, ToolSpec, XzError};

pub struct ProcOrgan;

#[async_trait]
impl Organ for ProcOrgan {
    fn family(&self) -> &str {
        "proc"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        vec![ToolSpec {
            name: "proc.list".into(),
            description: "List running processes (pid, name, rss_kb).".into(),
            input_schema: json!({"type": "object", "properties": {}}),
            risk: Risk::Observe,
            resource_args: vec![],
            tainted_output: false,
            first_party: true,
        }]
    }

    async fn call(&self, _ctx: &CallCtx, name: &str, _args: Value) -> Result<ToolOutput, XzError> {
        if name != "proc.list" {
            return Err(XzError::UnknownTool(name.into()));
        }
        let processes = list_processes()?;
        Ok(ToolOutput::clean(json!({
            "processes": processes,
        })))
    }
}

#[cfg(target_os = "linux")]
fn list_processes() -> Result<Vec<Value>> {
    let mut out = Vec::new();
    for ent in std::fs::read_dir("/proc")? {
        let ent = ent?;
        let pid = ent.file_name();
        let pid = pid.to_string_lossy();
        if !pid.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let name = std::fs::read_to_string(ent.path().join("comm"))
            .unwrap_or_default()
            .trim()
            .to_string();
        let rss_kb = rss(&ent.path());
        out.push(json!({
            "pid": pid.parse::<u64>().unwrap_or(0),
            "name": name,
            "rss_kb": rss_kb,
        }));
        if out.len() >= 300 {
            break;
        }
    }
    out.sort_by(|a, b| b["rss_kb"].as_u64().cmp(&a["rss_kb"].as_u64()));
    Ok(out)
}

#[cfg(target_os = "linux")]
fn rss(dir: &std::path::Path) -> u64 {
    let Ok(status) = std::fs::read_to_string(dir.join("status")) else {
        return 0;
    };
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            return rest
                .split_whitespace()
                .next()
                .unwrap_or("0")
                .parse()
                .unwrap_or(0);
        }
    }
    0
}

#[cfg(windows)]
fn list_processes() -> Result<Vec<Value>> {
    // tasklist is part of Windows. windows-rs process snapshots are TODO(phase 1).
    let out = std::process::Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()?;
    if !out.status.success() {
        return Err(XzError::Other("tasklist failed".into()));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut rows = Vec::new();
    for line in text.lines().take(300) {
        let cols = split_csv(line);
        if cols.len() < 2 {
            continue;
        }
        let pid = cols[1].parse::<u64>().unwrap_or(0);
        rows.push(json!({"pid": pid, "name": cols[0], "rss_kb": 0}));
    }
    Ok(rows)
}

#[cfg(windows)]
fn split_csv(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in line.chars() {
        match c {
            '"' => quoted = !quoted,
            ',' if !quoted => {
                out.push(std::mem::take(&mut cur));
            }
            _ => cur.push(c),
        }
    }
    out.push(cur);
    out
}

#[cfg(not(any(target_os = "linux", windows)))]
fn list_processes() -> Result<Vec<Value>> {
    Err(XzError::Unsupported("proc.list".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lists_this_process_on_linux() {
        let out = ProcOrgan
            .call(&CallCtx::test(), "proc.list", json!({}))
            .await
            .unwrap();
        let procs = out.content["processes"].as_array().unwrap();
        assert!(!procs.is_empty());
        #[cfg(target_os = "linux")]
        {
            let me = u64::from(std::process::id());
            assert!(procs.iter().any(|p| p["pid"].as_u64() == Some(me)));
        }
    }
}
