//! Path resolution shared by the Warden and the Organs.
//!
//! Both sides must resolve a path the same way, or a permission check
//! could approve one file while the Organ touches another.

use std::path::{Component, Path, PathBuf};

/// Resolves a user- or model-supplied path: expands `~`, joins relative
/// paths onto `home` (Organisms have no working directory), and removes
/// `.` and `..` lexically without touching the filesystem.
pub fn resolve(home: &Path, raw: &str) -> PathBuf {
    let expanded = if raw == "~" {
        home.to_path_buf()
    } else if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        home.join(rest)
    } else {
        let p = PathBuf::from(raw);
        if p.is_absolute() { p } else { home.join(p) }
    };
    normalize(&expanded)
}

/// Removes `.` and resolves `..` lexically. Never climbs above the root.
pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Prefix(_) | Component::RootDir => out.push(c.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                // `pop` refuses to remove the root or prefix, so `/..` stays `/`.
                if out.parent().is_some() {
                    out.pop();
                }
            }
            Component::Normal(s) => out.push(s),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn resolves_unix_paths() {
        let home = Path::new("/home/u");
        assert_eq!(resolve(home, "~"), PathBuf::from("/home/u"));
        assert_eq!(
            resolve(home, "~/Notes/a.md"),
            PathBuf::from("/home/u/Notes/a.md")
        );
        assert_eq!(
            resolve(home, "Notes/./b.md"),
            PathBuf::from("/home/u/Notes/b.md")
        );
        assert_eq!(
            resolve(home, "~/Notes/../../../etc/passwd"),
            PathBuf::from("/etc/passwd")
        );
        assert_eq!(resolve(home, "/../../x"), PathBuf::from("/x"));
        assert_eq!(resolve(home, "/tmp/a/../b"), PathBuf::from("/tmp/b"));
    }

    #[cfg(windows)]
    #[test]
    fn resolves_windows_paths() {
        let home = Path::new(r"C:\Users\u");
        assert_eq!(
            resolve(home, r"~\Notes\a.md"),
            PathBuf::from(r"C:\Users\u\Notes\a.md")
        );
        assert_eq!(resolve(home, r"C:\a\..\..\b"), PathBuf::from(r"C:\b"));
    }
}
