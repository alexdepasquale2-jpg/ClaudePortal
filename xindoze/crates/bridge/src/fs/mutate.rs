//! State-changing `fs` tools. Each reports the Effect Rewind needs to undo
//! it; the one irreversible tool reports `Irreversible`.

use serde::Deserialize;
use serde_json::{Value, json};
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use xz_types::{CallCtx, Effect, Result, Taint, ToolOutput, XzError};

use super::{children, exists, io_err, lstat};
use crate::paths::Roots;
use crate::util::parse_args;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WriteArgs {
    path: String,
    content: String,
    #[serde(default)]
    append: bool,
}

pub(super) fn write(r: &Roots, ctx: &CallCtx, args: Value) -> Result<ToolOutput> {
    let a: WriteArgs = parse_args("fs.write", args)?;
    let p = r.resolve_real("path", &a.path)?;
    let existed = match std::fs::symlink_metadata(&p) {
        Ok(m) if m.is_dir() => {
            return Err(XzError::InvalidArgs(format!(
                "`{}` is a folder; give a file path",
                p.display()
            )));
        }
        Ok(_) => true,
        Err(_) => false,
    };
    let mut effects = Vec::new();
    if existed {
        effects.push(match ctx.snapshot.snapshot(&p)? {
            Some(pre) => Effect::FileModified {
                path: p.clone(),
                pre,
            },
            None => Effect::Irreversible {
                note: format!("changed {} without a snapshot", p.display()),
            },
        });
    } else {
        effects.extend(make_parents(&p)?);
        effects.push(Effect::FileCreated { path: p.clone() });
    }
    let written = if a.append {
        OpenOptions::new()
            .append(true)
            .create(true)
            .open(&p)
            .and_then(|mut f| f.write_all(a.content.as_bytes()))
    } else {
        std::fs::write(&p, &a.content)
    };
    written.map_err(|e| io_err(&p, e))?;
    Ok(ToolOutput {
        content: json!({"path": p, "bytes_written": a.content.len(), "created": !existed}),
        taint: Taint::none(),
        effects,
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PathArg {
    path: String,
}

pub(super) fn mkdir(r: &Roots, args: Value) -> Result<ToolOutput> {
    let a: PathArg = parse_args("fs.mkdir", args)?;
    let p = r.resolve_real("path", &a.path)?;
    match std::fs::symlink_metadata(&p) {
        Ok(m) if m.is_dir() => {
            return Ok(ToolOutput::clean(json!({"path": p, "created": false})));
        }
        Ok(_) => {
            return Err(XzError::InvalidArgs(format!(
                "`{}` already exists and is not a folder",
                p.display()
            )));
        }
        Err(_) => {}
    }
    let top = topmost_missing(&p).unwrap_or_else(|| p.clone());
    std::fs::create_dir_all(&p).map_err(|e| io_err(&p, e))?;
    Ok(ToolOutput::clean(json!({"path": p, "created": true}))
        .with_effect(Effect::DirCreated { path: top }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FromTo {
    from: String,
    to: String,
}

pub(super) fn move_(r: &Roots, args: Value) -> Result<ToolOutput> {
    let a: FromTo = parse_args("fs.move", args)?;
    let (from, dest) = destination(r, "fs.move", &a)?;
    r.refuse_protected(&from)?;
    let mut effects: Vec<Effect> = make_parents(&dest)?.into_iter().collect();
    relocate(r, &from, &dest)?;
    effects.push(Effect::FileMoved {
        from: from.clone(),
        to: dest.clone(),
    });
    Ok(ToolOutput {
        content: json!({"from": from, "to": dest}),
        taint: Taint::none(),
        effects,
    })
}

pub(super) fn copy(r: &Roots, args: Value) -> Result<ToolOutput> {
    let a: FromTo = parse_args("fs.copy", args)?;
    let (from, dest) = destination(r, "fs.copy", &a)?;
    let mut effects: Vec<Effect> = make_parents(&dest)?.into_iter().collect();
    let skipped = copy_tree(r, &from, &dest)?;
    effects.push(Effect::FileCreated { path: dest.clone() });
    Ok(ToolOutput {
        content: json!({"from": from, "to": dest, "skipped_links": skipped}),
        taint: Taint::none(),
        effects,
    })
}

pub(super) fn trash(r: &Roots, ctx: &CallCtx, args: Value) -> Result<ToolOutput> {
    let a: PathArg = parse_args("fs.trash", args)?;
    let p = r.resolve_real("path", &a.path)?;
    lstat(&p)?;
    r.refuse_protected(&p)?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| XzError::InvalidArgs(format!("cannot trash `{}`", p.display())))?;
    let dir = r.data_dir.join("trash").join(safe_component(&ctx.task_id));
    std::fs::create_dir_all(&dir).map_err(|e| io_err(&dir, e))?;
    let dest = next_slot(&dir, &name);
    relocate(r, &p, &dest)?;
    Ok(
        ToolOutput::clean(json!({"path": p, "trashed_to": dest})).with_effect(
            Effect::FileTrashed {
                path: p,
                trashed_to: dest,
            },
        ),
    )
}

pub(super) fn delete_permanent(r: &Roots, args: Value) -> Result<ToolOutput> {
    let a: PathArg = parse_args("fs.delete_permanent", args)?;
    let p = r.resolve_real("path", &a.path)?;
    let m = lstat(&p)?;
    r.refuse_protected(&p)?;
    // `remove_dir_all` never follows links inside the tree.
    let removed = if m.is_dir() {
        std::fs::remove_dir_all(&p)
    } else {
        std::fs::remove_file(&p)
    };
    removed.map_err(|e| io_err(&p, e))?;
    Ok(
        ToolOutput::clean(json!({"deleted": p})).with_effect(Effect::Irreversible {
            note: format!("permanently deleted {}", p.display()),
        }),
    )
}

/// Resolves `from` and the final destination of a move or copy: into
/// `to` when it is an existing folder, else `to` itself. Never a path
/// that exists, and never inside `from`.
fn destination(r: &Roots, tool: &str, a: &FromTo) -> Result<(PathBuf, PathBuf)> {
    let from = r.resolve_real("from", &a.from)?;
    let to = r.resolve_real("to", &a.to)?;
    lstat(&from)?;
    let dest = match std::fs::symlink_metadata(&to) {
        Ok(m) if m.is_dir() => match from.file_name() {
            Some(name) => to.join(name),
            None => {
                return Err(XzError::InvalidArgs(format!(
                    "{tool}: cannot take `{}`",
                    from.display()
                )));
            }
        },
        _ => to,
    };
    if exists(&dest) {
        return Err(XzError::InvalidArgs(format!(
            "{tool}: `{}` already exists and {tool} never overwrites; choose another name \
             or trash the existing item first",
            dest.display()
        )));
    }
    if dest.starts_with(&from) {
        return Err(XzError::InvalidArgs(format!(
            "{tool}: cannot put `{}` inside itself",
            from.display()
        )));
    }
    Ok((from, dest))
}

/// The highest ancestor of `p` (or `p` itself) that does not exist yet.
fn topmost_missing(p: &Path) -> Option<PathBuf> {
    p.ancestors()
        .take_while(|a| !exists(a))
        .last()
        .map(Path::to_path_buf)
}

/// Creates the missing parents of `p`, reporting the topmost one created.
fn make_parents(p: &Path) -> Result<Option<Effect>> {
    let Some(parent) = p.parent() else {
        return Ok(None);
    };
    let Some(top) = topmost_missing(parent) else {
        return Ok(None);
    };
    std::fs::create_dir_all(parent).map_err(|e| io_err(parent, e))?;
    Ok(Some(Effect::DirCreated { path: top }))
}

/// Renames, falling back to copy-and-delete across filesystems (the
/// trash may live on another drive than the file).
fn relocate(r: &Roots, from: &Path, to: &Path) -> Result<()> {
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::CrossesDevices => {
            if copy_tree(r, from, to)? > 0 {
                // Deleting the source would lose what was not copied.
                let _ = remove_any(to);
                return Err(XzError::InvalidArgs(format!(
                    "`{}` contains symbolic links, which cannot be moved to another drive",
                    from.display()
                )));
            }
            remove_any(from).map_err(|e| io_err(from, e))
        }
        Err(e) => Err(io_err(from, e)),
    }
}

fn remove_any(p: &Path) -> io::Result<()> {
    if std::fs::symlink_metadata(p)?.is_dir() {
        std::fs::remove_dir_all(p)
    } else {
        std::fs::remove_file(p)
    }
}

/// Copies a file or a folder tree without overwriting anything. Links
/// (and the data directory) are skipped, not followed; returns how many
/// entries were skipped.
fn copy_tree(r: &Roots, from: &Path, to: &Path) -> Result<usize> {
    let m = lstat(from)?;
    if m.is_file() {
        let mut src = std::fs::File::open(from).map_err(|e| io_err(from, e))?;
        let mut dst = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(to)
            .map_err(|e| io_err(to, e))?;
        io::copy(&mut src, &mut dst).map_err(|e| io_err(to, e))?;
        dst.set_permissions(m.permissions())
            .map_err(|e| io_err(to, e))?;
        return Ok(0);
    }
    if !m.is_dir() {
        return Ok(1);
    }
    std::fs::create_dir(to).map_err(|e| io_err(to, e))?;
    let mut skipped = 0;
    for (child, cm) in children(from)? {
        if cm.file_type().is_symlink() || r.is_data(&child) {
            skipped += 1;
            continue;
        }
        if let Some(name) = child.file_name() {
            skipped += copy_tree(r, &child, &to.join(name))?;
        }
    }
    Ok(skipped)
}

/// Picks `<n>-<name>` in the trash folder, never reusing a slot.
fn next_slot(dir: &Path, name: &str) -> PathBuf {
    let mut n = std::fs::read_dir(dir).map(|d| d.count()).unwrap_or(0);
    loop {
        let candidate = dir.join(format!("{n}-{name}"));
        if !exists(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Task ids come from the core, but they become a folder name: keep them
/// to one harmless path component.
fn safe_component(id: &str) -> String {
    let s: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() || s.chars().all(|c| c == '.') {
        "_".into()
    } else {
        s
    }
}
