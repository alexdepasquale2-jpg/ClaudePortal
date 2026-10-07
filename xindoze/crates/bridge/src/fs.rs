//! `fs` Organ (SPEC Appendix D). Phase 0 serves the observe tools the
//! Spark loop needs. Writes, moves, and deletes are TODO(phase 1): Rewind
//! already knows their effects, and the Organ should grow them with the
//! acceptance test that moves files.

use async_trait::async_trait;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use xz_types::path::resolve;
use xz_types::{CallCtx, Organ, Result, Risk, ToolOutput, ToolSpec, XzError};

const MAX_READ: u64 = 1024 * 1024;
const MAX_LIST: usize = 1_000;
const MAX_WALK: usize = 20_000;
const MAX_DEPTH: usize = 8;

pub struct FsOrgan {
    home: PathBuf,
    data_dir: PathBuf,
}

impl FsOrgan {
    pub fn new(home: impl Into<PathBuf>, data_dir: impl Into<PathBuf>) -> Self {
        Self {
            home: home.into(),
            data_dir: data_dir.into(),
        }
    }

    fn guard(&self, raw: &str) -> Result<PathBuf> {
        let path = resolve(&self.home, raw);
        if path.starts_with(&self.data_dir) {
            return Err(XzError::Denied(
                "that path is inside the Xindoze data directory".into(),
            ));
        }
        Ok(path)
    }
}

#[async_trait]
impl Organ for FsOrgan {
    fn family(&self) -> &str {
        "fs"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        vec![
            tool("fs.read", "Read a text file.", Risk::Observe, true),
            tool("fs.list", "List one directory.", Risk::Observe, false),
            tool("fs.stat", "Stat one path.", Risk::Observe, false),
            tool(
                "fs.search",
                "Find files under a directory. `largest` returns the biggest files visited (the walk stops at 20000 files and depth 8).",
                Risk::Observe,
                false,
            ),
        ]
    }

    async fn call(&self, _ctx: &CallCtx, name: &str, args: Value) -> Result<ToolOutput, XzError> {
        let raw = str_arg(&args, "path")?;
        let path = self.guard(raw)?;
        match name {
            "fs.read" => read_file(&path, u64_arg(&args, "max_bytes", MAX_READ, MAX_READ)),
            "fs.list" => list_dir(&path),
            "fs.stat" => stat_path(&path),
            "fs.search" => search(
                &path,
                &self.data_dir,
                args.get("name").and_then(Value::as_str),
                u64_arg(&args, "largest", 50, 100) as usize,
            ),
            other => Err(XzError::UnknownTool(other.into())),
        }
    }
}

fn tool(name: &str, description: &str, risk: Risk, tainted: bool) -> ToolSpec {
    ToolSpec {
        name: name.into(),
        description: description.into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "largest": {"type": "integer"},
                "name": {"type": "string"},
                "max_bytes": {"type": "integer"}
            },
            "required": ["path"]
        }),
        risk,
        resource_args: vec!["path".into()],
        tainted_output: tainted,
        first_party: true,
    }
}

fn read_file(path: &Path, max: u64) -> Result<ToolOutput> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        return Err(XzError::Denied(format!(
            "{} is a symlink; fs.read will not follow it",
            path.display()
        )));
    }
    if !meta.is_file() {
        return Err(XzError::InvalidArgs(format!(
            "{} is not a file",
            path.display()
        )));
    }
    let bytes = fs::read(path)?;
    let truncated = bytes.len() as u64 > max;
    let slice = if truncated {
        &bytes[..max as usize]
    } else {
        &bytes
    };
    let (text, binary) = match std::str::from_utf8(slice) {
        Ok(t) => (Some(t.to_string()), false),
        Err(_) => (None, true),
    };
    Ok(ToolOutput::tainted(
        json!({
            "path": path,
            "bytes": bytes.len(),
            "truncated": truncated,
            "binary": binary,
            "text": text,
        }),
        format!("file:{}", path.display()),
    ))
}

fn list_dir(path: &Path) -> Result<ToolOutput> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        return Err(XzError::Denied("fs.list will not follow a symlink".into()));
    }
    let mut entries = Vec::new();
    for ent in fs::read_dir(path)? {
        if entries.len() >= MAX_LIST {
            break;
        }
        let ent = ent?;
        let kind = kind(&ent.file_type()?);
        let bytes = ent.metadata().map(|m| m.len()).unwrap_or(0);
        entries.push(json!({
            "name": ent.file_name().to_string_lossy(),
            "kind": kind,
            "bytes": bytes,
        }));
    }
    entries.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(ToolOutput::clean(json!({
        "path": path,
        "entries": entries,
    })))
}

fn stat_path(path: &Path) -> Result<ToolOutput> {
    let meta = fs::symlink_metadata(path)?;
    Ok(ToolOutput::clean(json!({
        "path": path,
        "kind": kind(&meta.file_type()),
        "bytes": meta.len(),
    })))
}

struct Hit {
    path: PathBuf,
    bytes: u64,
}

fn search(root: &Path, data_dir: &Path, name: Option<&str>, largest: usize) -> Result<ToolOutput> {
    let mut hits = Vec::new();
    let mut visited = 0usize;
    let mut truncated = false;
    let meta = fs::symlink_metadata(root)?;
    if meta.file_type().is_symlink() {
        return Err(XzError::Denied(
            "fs.search will not follow a symlink".into(),
        ));
    }
    if meta.is_file() {
        if name_ok(root, name) {
            hits.push(Hit {
                path: root.to_path_buf(),
                bytes: meta.len(),
            });
        }
    } else if meta.is_dir() {
        walk(
            root,
            data_dir,
            name,
            0,
            &mut hits,
            &mut visited,
            &mut truncated,
        );
    } else {
        return Err(XzError::InvalidArgs(format!(
            "{} is not a file or directory",
            root.display()
        )));
    }
    hits.sort_by(|a, b| b.bytes.cmp(&a.bytes).then(a.path.cmp(&b.path)));
    let shown: Vec<_> = hits.iter().take(largest.max(1)).collect();
    if hits.len() > shown.len() {
        truncated = true;
    }
    let files: Vec<_> = shown
        .iter()
        .map(|h| json!({"path": h.path, "bytes": h.bytes}))
        .collect();
    Ok(ToolOutput::clean(json!({
        "root": root,
        "files": files,
        "truncated": truncated,
    })))
}

fn walk(
    dir: &Path,
    data_dir: &Path,
    name: Option<&str>,
    depth: usize,
    hits: &mut Vec<Hit>,
    visited: &mut usize,
    truncated: &mut bool,
) {
    if depth > MAX_DEPTH || *visited >= MAX_WALK {
        *truncated = true;
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for ent in rd.flatten() {
        *visited += 1;
        if *visited > MAX_WALK {
            *truncated = true;
            return;
        }
        let path = ent.path();
        if path.starts_with(data_dir) {
            continue;
        }
        let Ok(ft) = ent.file_type() else {
            continue;
        };
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            walk(&path, data_dir, name, depth + 1, hits, visited, truncated);
        } else if ft.is_file() && name_ok(&path, name) {
            let bytes = ent.metadata().map(|m| m.len()).unwrap_or(0);
            hits.push(Hit { path, bytes });
        }
    }
}

fn name_ok(path: &Path, name: Option<&str>) -> bool {
    match name {
        None | Some("") => true,
        Some(n) => path
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|file| file.to_lowercase().contains(&n.to_lowercase())),
    }
}

fn kind(ft: &std::fs::FileType) -> &'static str {
    if ft.is_symlink() {
        "symlink"
    } else if ft.is_dir() {
        "dir"
    } else if ft.is_file() {
        "file"
    } else {
        "other"
    }
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| XzError::InvalidArgs(format!("missing `{key}`")))
}

fn u64_arg(args: &Value, key: &str, default: u64, max: u64) -> u64 {
    match args.get(key).and_then(Value::as_u64) {
        Some(0) | None => default.min(max),
        Some(n) => n.min(max),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn organ(home: &Path) -> FsOrgan {
        FsOrgan::new(home, home.join(".xindoze"))
    }

    #[tokio::test]
    async fn search_returns_largest_and_skips_the_data_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        fs::create_dir_all(home.join(".xindoze")).unwrap();
        fs::write(home.join(".xindoze/secret"), vec![9u8; 50_000]).unwrap();
        fs::create_dir_all(home.join(".cache")).unwrap();
        fs::write(home.join("small.txt"), b"hi").unwrap();
        fs::write(home.join(".cache/junk.bin"), vec![1u8; 80]).unwrap();
        fs::write(home.join("big.bin"), vec![2u8; 200]).unwrap();
        let out = organ(home)
            .call(
                &CallCtx::test(),
                "fs.search",
                json!({"path": "~", "largest": 2}),
            )
            .await
            .unwrap();
        assert!(out.taint.is_clean());
        let files = out.content["files"].as_array().unwrap();
        assert_eq!(files.len(), 2);
        assert!(files[0]["path"].as_str().unwrap().ends_with("big.bin"));
        assert_eq!(files[0]["bytes"], 200);
        assert!(
            files
                .iter()
                .all(|f| !f["path"].as_str().unwrap().contains(".xindoze"))
        );
        let err = organ(home)
            .call(
                &CallCtx::test(),
                "fs.read",
                json!({"path": "~/.xindoze/secret"}),
            )
            .await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn read_taints_file_text() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("n.txt"), "hello").unwrap();
        let out = organ(tmp.path())
            .call(&CallCtx::test(), "fs.read", json!({"path": "n.txt"}))
            .await
            .unwrap();
        assert_eq!(out.content["text"], "hello");
        assert!(!out.taint.is_clean());
    }
}
