//! The `fs` Organ: files and folders (SPEC Appendix D).
//!
//! Every path goes through `Roots::resolve_real`, so the Organ touches
//! exactly the path the Warden approved: no symlinks, no data directory.
//! State changes report an [`xz_types::Effect`] so Rewind can undo them.

mod mutate;
mod observe;
mod search;
mod specs;
#[cfg(test)]
mod tests;

use async_trait::async_trait;
use serde_json::{Value, json};
use std::fs::Metadata;
use std::io;
use std::path::{Path, PathBuf};
use xz_types::{CallCtx, Organ, Result, ToolOutput, ToolSpec, XzError};

use crate::paths::Roots;
use crate::util::{blocking, rfc3339};

/// Serves `fs.*`. Cheap to clone.
#[derive(Clone, Debug)]
pub struct FsOrgan {
    roots: Roots,
}

impl FsOrgan {
    /// `home` anchors `~` and relative paths; trash lives in `data_dir`.
    pub fn new(home: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            roots: Roots::new(home, data_dir),
        }
    }

    fn dispatch(&self, ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        let r = &self.roots;
        match tool {
            "fs.read" => observe::read(r, args),
            "fs.list" => observe::list(r, args),
            "fs.stat" => observe::stat(r, args),
            "fs.search" => search::search(r, args),
            "fs.write" => mutate::write(r, ctx, args),
            "fs.mkdir" => mutate::mkdir(r, args),
            "fs.move" => mutate::move_(r, args),
            "fs.copy" => mutate::copy(r, args),
            "fs.trash" => mutate::trash(r, ctx, args),
            "fs.delete_permanent" => mutate::delete_permanent(r, args),
            _ => Err(XzError::UnknownTool(tool.into())),
        }
    }
}

#[async_trait]
impl Organ for FsOrgan {
    fn family(&self) -> &str {
        "fs"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        specs::all()
    }

    async fn call(&self, ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        let (me, ctx, tool) = (self.clone(), ctx.clone(), tool.to_owned());
        blocking(move || me.dispatch(&ctx, &tool, args)).await
    }
}

/// Maps an I/O error to one that names the path; a missing path becomes
/// `NotFound` so the planner knows to look elsewhere.
fn io_err(p: &Path, e: io::Error) -> XzError {
    if e.kind() == io::ErrorKind::NotFound {
        XzError::NotFound(format!("`{}` does not exist", p.display()))
    } else {
        XzError::Io(io::Error::new(e.kind(), format!("{}: {e}", p.display())))
    }
}

/// `symlink_metadata` with a path-naming error.
fn lstat(p: &Path) -> Result<Metadata> {
    std::fs::symlink_metadata(p).map_err(|e| io_err(p, e))
}

/// True if something (even a dangling link) exists at `p`.
fn exists(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok()
}

fn kind(m: &Metadata) -> &'static str {
    let t = m.file_type();
    if t.is_symlink() {
        "symlink"
    } else if t.is_dir() {
        "dir"
    } else if t.is_file() {
        "file"
    } else {
        "other"
    }
}

/// The JSON description of one entry, shared by list, stat and search.
fn describe(p: &Path, m: &Metadata) -> Value {
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut v = json!({"name": name, "path": p, "kind": kind(m)});
    if m.is_file() {
        v["size"] = json!(m.len());
    }
    if let Ok(t) = m.modified() {
        v["modified"] = json!(rfc3339(t));
    }
    if m.file_type().is_symlink() {
        if let Ok(target) = std::fs::read_link(p) {
            v["target"] = json!(target);
        }
    }
    v
}

/// A directory's entries sorted by name, without following links.
/// Unreadable entries are skipped: a walk must not fail on one bad file.
fn children(dir: &Path) -> Result<Vec<(PathBuf, Metadata)>> {
    let mut v: Vec<(PathBuf, Metadata)> = std::fs::read_dir(dir)
        .map_err(|e| io_err(dir, e))?
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok().map(|m| (e.path(), m)))
        .collect();
    v.sort_by(|a, b| a.0.file_name().cmp(&b.0.file_name()));
    Ok(v)
}
