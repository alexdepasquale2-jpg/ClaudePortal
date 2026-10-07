//! Loading genome files from a directory (Seed Bank or `<data>/genomes/`).

use crate::genome::Genome;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use xz_types::XzError;

/// File name suffix of genome files.
pub const EXTENSION: &str = ".genome.md";

/// Parses every `*.genome.md` under `dir`, recursively, sorted by path.
///
/// Hidden entries are skipped and symlinked directories are not followed.
/// A missing `dir` yields nothing; an unreadable directory yields one
/// error entry for that directory. Parsed genomes are not validated.
pub fn load_dir(dir: &Path) -> Vec<(PathBuf, Result<Genome, XzError>)> {
    let mut out = vec![];
    walk(dir, &mut out);
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn walk(dir: &Path, out: &mut Vec<(PathBuf, Result<Genome, XzError>)>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == ErrorKind::NotFound => return,
        Err(e) => return out.push((dir.to_path_buf(), Err(e.into()))),
    };
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                out.push((dir.to_path_buf(), Err(e.into())));
                continue;
            }
        };
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        match entry.file_type() {
            Ok(t) if t.is_dir() => walk(&path, out),
            Ok(_) if name.ends_with(EXTENSION) => {
                let parsed = fs::read_to_string(&path)
                    .map_err(XzError::from)
                    .and_then(|text| Genome::parse(&text));
                out.push((path, parsed));
            }
            Ok(_) => {}
            Err(e) => out.push((path, Err(e.into()))),
        }
    }
}
