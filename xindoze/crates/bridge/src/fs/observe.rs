//! `fs.read`, `fs.list`, `fs.stat`.

use serde::Deserialize;
use serde_json::{Value, json};
use std::io::Read;
use xz_types::{Result, ToolOutput, XzError};

use super::{children, describe, io_err, lstat};
use crate::content::{as_text, is_pdf, pdf_text};
use crate::paths::Roots;
use crate::util::{in_range, parse_args, truncate};

/// Default `max_bytes` for `fs.read`: enough for a long document, small
/// enough not to flood a small model's context.
const READ_DEFAULT: u64 = 256 * 1024;

/// Largest PDF `fs.read` parses; PDF text needs the whole file in memory.
const PDF_MAX: u64 = 100 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadArgs {
    path: String,
    max_bytes: Option<u64>,
}

pub(super) fn read(r: &Roots, args: Value) -> Result<ToolOutput> {
    let a: ReadArgs = parse_args("fs.read", args)?;
    let max = in_range(
        "fs.read",
        "max_bytes",
        a.max_bytes.unwrap_or(READ_DEFAULT),
        1,
        u64::MAX,
    )?;
    let p = r.resolve_real("path", &a.path)?;
    let meta = std::fs::metadata(&p).map_err(|e| io_err(&p, e))?;
    if meta.is_dir() {
        return Err(XzError::InvalidArgs(format!(
            "`{}` is a folder; use fs.list to see what is inside",
            p.display()
        )));
    }
    let size = meta.len();
    let file = std::fs::File::open(&p).map_err(|e| io_err(&p, e))?;
    // One byte past `max` tells whether the text was cut, whatever the
    // metadata says (some virtual files report size 0); 1 KB at least to
    // sniff for a PDF header.
    let mut head = Vec::new();
    file.take(max.max(1024).saturating_add(1))
        .read_to_end(&mut head)
        .map_err(|e| io_err(&p, e))?;
    let max = usize::try_from(max).unwrap_or(usize::MAX);

    if is_pdf(&head) {
        if size > PDF_MAX {
            return Err(XzError::InvalidArgs(format!(
                "`{}` is a {} MB PDF; the limit for reading is {} MB",
                p.display(),
                size >> 20,
                PDF_MAX >> 20
            )));
        }
        let bytes = std::fs::read(&p).map_err(|e| io_err(&p, e))?;
        let mut text = pdf_text(&bytes)?;
        let truncated = truncate(&mut text, max);
        return Ok(ToolOutput::clean(json!({
            "path": p, "kind": "pdf", "size": size, "text": text, "truncated": truncated
        })));
    }

    let cut = head.len() > max;
    head.truncate(max);
    match as_text(&head, cut) {
        Some(text) => Ok(ToolOutput::clean(json!({
            "path": p, "kind": "text", "size": size, "text": text, "truncated": cut
        }))),
        None => Ok(ToolOutput::clean(json!({
            "path": p, "binary": true, "size": size
        }))),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListArgs {
    path: String,
    #[serde(default)]
    recursive: bool,
    limit: Option<u64>,
}

pub(super) fn list(r: &Roots, args: Value) -> Result<ToolOutput> {
    let a: ListArgs = parse_args("fs.list", args)?;
    let limit = in_range("fs.list", "limit", a.limit.unwrap_or(200), 1, 10_000)? as usize;
    let root = r.resolve_real("path", &a.path)?;
    if !lstat(&root)?.is_dir() {
        return Err(XzError::InvalidArgs(format!(
            "`{}` is not a folder; use fs.stat or fs.read",
            root.display()
        )));
    }
    // Depth-first in name order, so the listing reads like a tree.
    let mut stack: Vec<_> = children(&root)?.into_iter().rev().collect();
    let mut entries = Vec::new();
    let mut truncated = false;
    while let Some((p, m)) = stack.pop() {
        if entries.len() == limit {
            truncated = true;
            break;
        }
        entries.push(describe(&p, &m));
        if a.recursive && m.is_dir() && !r.is_data(&p) {
            if let Ok(kids) = children(&p) {
                stack.extend(kids.into_iter().rev());
            }
        }
    }
    Ok(ToolOutput::clean(json!({
        "path": root, "entries": entries, "truncated": truncated
    })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StatArgs {
    path: String,
}

pub(super) fn stat(r: &Roots, args: Value) -> Result<ToolOutput> {
    let a: StatArgs = parse_args("fs.stat", args)?;
    let p = r.resolve("path", &a.path)?;
    r.refuse_links(&p, false)?;
    let m = match std::fs::symlink_metadata(&p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ToolOutput::clean(json!({"path": p, "exists": false})));
        }
        Err(e) => return Err(io_err(&p, e)),
    };
    let mut v = describe(&p, &m);
    v["exists"] = json!(true);
    v["readonly"] = json!(m.permissions().readonly());
    if let Ok(t) = m.created() {
        v["created"] = json!(crate::util::rfc3339(t));
    }
    Ok(ToolOutput::clean(v))
}
