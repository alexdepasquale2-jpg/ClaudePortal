//! Path resolution and the guards that keep Organs in step with the Warden.
//!
//! The Warden approves paths lexically (`path::resolve`, no filesystem
//! access). A symbolic link inside a granted folder could point anywhere,
//! so the Organs refuse to go through one: the path they touch is then
//! exactly the path the Warden approved.

use std::path::{Path, PathBuf};
use xz_types::path::{normalize, resolve};
use xz_types::{Result, XzError};

/// The two roots every path-taking Organ needs.
#[derive(Clone, Debug)]
pub(crate) struct Roots {
    pub home: PathBuf,
    pub data_dir: PathBuf,
}

impl Roots {
    /// Normalizes both roots the way the Warden does.
    pub fn new(home: PathBuf, data_dir: PathBuf) -> Self {
        let home = normalize(&home);
        let data_dir = normalize(&home.join(data_dir));
        Self { home, data_dir }
    }

    /// Resolves `raw` exactly as the Warden does and refuses the data
    /// directory (defense in depth: the Warden denies it first).
    pub fn resolve(&self, arg: &str, raw: &str) -> Result<PathBuf> {
        if raw.is_empty() {
            return Err(XzError::InvalidArgs(format!("`{arg}` must not be empty")));
        }
        let p = resolve(&self.home, raw);
        if !p.is_absolute() {
            return Err(XzError::InvalidArgs(format!(
                "`{arg}` = `{raw}` does not resolve to an absolute path"
            )));
        }
        if self.is_data(&p) {
            return Err(XzError::Denied(format!(
                "`{raw}` is inside the Xindoze data directory, which tools cannot touch"
            )));
        }
        Ok(p)
    }

    /// [`Roots::resolve`] plus: no existing component may be a symlink.
    pub fn resolve_real(&self, arg: &str, raw: &str) -> Result<PathBuf> {
        let p = self.resolve(arg, raw)?;
        self.refuse_links(&p, true)?;
        Ok(p)
    }

    /// Refuses `p` if one of its existing components is a symbolic link
    /// (or a Windows junction). The last component is checked only when
    /// `include_last` is set, so `fs.stat` can describe a link itself.
    ///
    /// Components at or above home are exempt: a symlinked home (or `/home`
    /// itself) moves every path together and cannot widen a grant.
    pub fn refuse_links(&self, p: &Path, include_last: bool) -> Result<()> {
        let mut prefixes: Vec<&Path> = p.ancestors().collect();
        prefixes.reverse();
        for prefix in prefixes {
            if prefix == p && !include_last {
                break;
            }
            if self.home.starts_with(prefix) {
                continue;
            }
            match std::fs::symlink_metadata(prefix) {
                Ok(m) if m.file_type().is_symlink() => {
                    let target = std::fs::read_link(prefix)
                        .map(|t| format!(" (it points to `{}`)", t.display()))
                        .unwrap_or_default();
                    return Err(XzError::InvalidArgs(format!(
                        "`{}` is a symbolic link{target}. Xindoze does not follow links because \
                         permissions are checked on the path as written; use the real path instead",
                        prefix.display()
                    )));
                }
                Ok(_) => {}
                // Nothing below a missing component exists either.
                Err(_) => break,
            }
        }
        Ok(())
    }

    /// Refuses paths whose removal or relocation would take the home folder
    /// or the data directory with them.
    pub fn refuse_protected(&self, p: &Path) -> Result<()> {
        if self.home.starts_with(p) || within(&self.data_dir, p) {
            return Err(XzError::InvalidArgs(format!(
                "`{}` contains your home folder or the Xindoze data directory; refusing to \
                 move or delete it",
                p.display()
            )));
        }
        Ok(())
    }

    /// True if `p` is the data directory or inside it. Compared without
    /// case, because some filesystems fold case and a refusal must not be
    /// dodged by spelling.
    pub fn is_data(&self, p: &Path) -> bool {
        within(p, &self.data_dir)
    }
}

/// True if `child` is `parent` or lies below it, ignoring case.
fn within(child: &Path, parent: &Path) -> bool {
    let lower = |p: &Path| PathBuf::from(p.to_string_lossy().to_lowercase());
    lower(child).starts_with(lower(parent))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots(dir: &Path) -> Roots {
        Roots::new(dir.join("home"), dir.join("home/.xz"))
    }

    #[test]
    fn resolves_like_the_warden() {
        let t = tempfile::tempdir().unwrap();
        let r = roots(t.path());
        assert_eq!(r.resolve("p", "~/a/../b").unwrap(), t.path().join("home/b"));
        assert_eq!(
            r.resolve("p", "notes").unwrap(),
            t.path().join("home/notes")
        );
        assert!(matches!(r.resolve("p", ""), Err(XzError::InvalidArgs(_))));
        assert!(matches!(
            r.resolve("p", "~/.XZ/charter.toml"),
            Err(XzError::Denied(_))
        ));
        assert!(matches!(r.resolve("p", "~/.xz"), Err(XzError::Denied(_))));
        assert!(r.resolve("p", "~/.xzz").is_ok());
    }

    #[test]
    fn protects_home_and_data() {
        let t = tempfile::tempdir().unwrap();
        let r = roots(t.path());
        assert!(r.refuse_protected(&t.path().join("home")).is_err());
        assert!(r.refuse_protected(t.path()).is_err());
        assert!(r.refuse_protected(&t.path().join("home/.xz")).is_err());
        assert!(r.refuse_protected(&t.path().join("home/a")).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks() {
        let t = tempfile::tempdir().unwrap();
        let r = roots(t.path());
        let home = t.path().join("home");
        std::fs::create_dir_all(home.join("real")).unwrap();
        std::os::unix::fs::symlink(home.join("real"), home.join("link")).unwrap();
        let err = r.resolve_real("p", "~/link/x").unwrap_err().to_string();
        assert!(err.contains("link") && err.contains("symbolic"), "{err}");
        assert!(r.resolve_real("p", "~/real/x/y").is_ok());
        // The last component may be a link when the caller asks.
        let link = home.join("link");
        assert!(r.refuse_links(&link, false).is_ok());
        assert!(r.refuse_links(&link, true).is_err());
        // A symlinked home is fine.
        std::os::unix::fs::symlink(&home, t.path().join("home2")).unwrap();
        let r2 = Roots::new(t.path().join("home2"), t.path().join("data"));
        assert!(r2.resolve_real("p", "~/real").is_ok());
    }
}
