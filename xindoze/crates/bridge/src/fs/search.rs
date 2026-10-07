//! `fs.search`: a bounded walk in name order, so results are deterministic.

use globset::{GlobBuilder, GlobMatcher};
use serde::Deserialize;
use serde_json::{Value, json};
use std::cmp::Reverse;
use std::fs::Metadata;
use std::path::{Path, PathBuf};
use xz_types::{Result, ToolOutput, XzError};

use super::{children, describe, lstat};
use crate::content::{as_text, is_pdf, pdf_text};
use crate::paths::Roots;
use crate::util::{in_range, parse_args};

/// Entries visited before the walk gives up.
const MAX_ENTRIES: usize = 100_000;

/// Larger files are not opened for `contains`.
const CONTENT_MAX: u64 = 20 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchArgs {
    root: String,
    name_glob: Option<String>,
    contains: Option<String>,
    sort: Option<Sort>,
    limit: Option<u64>,
    min_size: Option<u64>,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Sort {
    Size,
    Modified,
    Name,
}

/// The filters of one search.
struct Filter {
    glob: Option<GlobMatcher>,
    needle: Option<String>,
    min_size: Option<u64>,
}

impl Filter {
    /// Folders match only a pure name search: they have no content or size.
    fn dir_matches(&self, name: &str) -> bool {
        self.needle.is_none() && self.min_size.is_none() && self.name_matches(name, true)
    }

    fn name_matches(&self, name: &str, required: bool) -> bool {
        match &self.glob {
            Some(g) => g.is_match(name),
            None => !required,
        }
    }

    fn file_matches(&self, p: &Path, name: &str, m: &Metadata) -> bool {
        self.name_matches(name, false)
            && self.min_size.is_none_or(|s| m.len() >= s)
            && self
                .needle
                .as_ref()
                .is_none_or(|n| m.len() <= CONTENT_MAX && file_contains(p, n))
    }
}

pub(super) fn search(r: &Roots, args: Value) -> Result<ToolOutput> {
    let a: SearchArgs = parse_args("fs.search", args)?;
    let limit = in_range("fs.search", "limit", a.limit.unwrap_or(50), 1, 1000)? as usize;
    let root = r.resolve_real("root", &a.root)?;
    if !lstat(&root)?.is_dir() {
        return Err(XzError::InvalidArgs(format!(
            "`{}` is not a folder; `root` must be the folder to search in",
            root.display()
        )));
    }
    let filter = Filter {
        glob: a.name_glob.as_deref().map(compile).transpose()?,
        needle: a
            .contains
            .filter(|s| !s.is_empty())
            .map(|s| s.to_lowercase()),
        min_size: a.min_size,
    };

    let mut stack: Vec<_> = children(&root)?.into_iter().rev().collect();
    let mut hits: Vec<(PathBuf, Metadata)> = Vec::new();
    let mut visited = 0;
    let mut walk_capped = false;
    while let Some((p, m)) = stack.pop() {
        visited += 1;
        if visited > MAX_ENTRIES {
            walk_capped = true;
            break;
        }
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if m.is_dir() {
            if filter.dir_matches(&name) {
                hits.push((p.clone(), m.clone()));
            }
            if !name.starts_with('.') && !r.is_data(&p) {
                if let Ok(kids) = children(&p) {
                    stack.extend(kids.into_iter().rev());
                }
            }
        } else if m.is_file() && filter.file_matches(&p, &name, &m) {
            hits.push((p, m));
        }
        // Symlinks are never followed or matched.
    }

    // Stable sorts keep walk order among ties.
    match a.sort {
        Some(Sort::Size) => hits.sort_by_key(|(_, m)| Reverse(m.len())),
        Some(Sort::Modified) => hits.sort_by_key(|(_, m)| Reverse(m.modified().ok())),
        Some(Sort::Name) => hits.sort_by_cached_key(|(p, _)| {
            p.file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default()
        }),
        None => {}
    }
    let total = hits.len();
    let matches: Vec<Value> = hits
        .iter()
        .take(limit)
        .map(|(p, m)| describe(p, m))
        .collect();
    Ok(ToolOutput::clean(json!({
        "root": root,
        "matches": matches,
        "total_matches": total,
        "truncated": total > limit,
        "walk_capped": walk_capped
    })))
}

fn compile(glob: &str) -> Result<GlobMatcher> {
    if glob.contains(['/', '\\']) {
        return Err(XzError::InvalidArgs(
            "fs.search: `name_glob` matches file names only and must not contain a path \
             separator; narrow `root` instead"
                .into(),
        ));
    }
    GlobBuilder::new(glob)
        .case_insensitive(true)
        .build()
        .map(|g| g.compile_matcher())
        .map_err(|e| XzError::InvalidArgs(format!("fs.search: invalid `name_glob`: {e}")))
}

/// Case-insensitive search in a text file or a PDF.
fn file_contains(p: &Path, needle: &str) -> bool {
    let Ok(bytes) = std::fs::read(p) else {
        return false;
    };
    let text = if is_pdf(&bytes) {
        pdf_text(&bytes).ok()
    } else {
        as_text(&bytes, false)
    };
    text.is_some_and(|t| t.to_lowercase().contains(needle))
}
