//! Glob compilation and matching for names, paths and URLs.
//!
//! Every glob is compiled in one of two modes. Restrictive globs (deny and
//! ask rules) ignore case everywhere, because some filesystems fold case
//! and a deny rule must not be dodged by spelling. Permissive globs (grants
//! and allow rules) ignore case only where the platform's filesystems
//! usually do, so a grant never reaches a second, differently cased file.

use globset::{GlobBuilder, GlobMatcher};
use std::path::{Path, is_separator};
use xz_types::path::resolve;

use crate::resource::Resource;

/// True where the usual filesystem folds case, so `C:\Users` and
/// `c:\users` name the same file.
pub(crate) const FOLDS_CASE: bool = cfg!(any(
    windows,
    target_os = "macos",
    target_os = "ios",
    target_os = "android"
));

/// Whether a glob widens or narrows what an Organism may do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    /// Grants and allow rules: match exactly what was written.
    Permit,
    /// Deny and ask rules: match every spelling that could reach the target.
    Restrict,
}

/// Characters that make a path component a pattern rather than a literal.
const META: &[char] = &['*', '?', '[', ']', '{', '}'];

fn build(pattern: &str, literal_separator: bool, fold: bool) -> Result<GlobMatcher, String> {
    GlobBuilder::new(pattern)
        .literal_separator(literal_separator)
        .case_insensitive(fold)
        // Backslash is a path separator on Windows and a filename byte on
        // Unix; it must never silently escape the next character.
        .backslash_escape(false)
        .build()
        .map(|g| g.compile_matcher())
        .map_err(|e| format!("invalid glob `{pattern}`: {e}"))
}

/// Compiles a glob over names (organisms, tools, domains), where `*`
/// matches any run of characters.
pub(crate) fn name_glob(pattern: &str, mode: Mode) -> Result<GlobMatcher, String> {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return Err("empty glob".into());
    }
    build(pattern, false, mode == Mode::Restrict)
}

/// Compiles a domain glob such as `*.wikipedia.org`. Hostnames are case
/// insensitive by definition, so this always folds case.
pub(crate) fn domain_glob(pattern: &str) -> Result<GlobMatcher, String> {
    name_glob(pattern.trim().trim_end_matches('.'), Mode::Restrict)
}

/// The scheme of a URL-shaped value, e.g. `https` in `https://x`.
///
/// A single letter before the colon is a Windows drive (`C:\x`), not a scheme.
pub(crate) fn scheme(raw: &str) -> Option<&str> {
    let (head, _) = raw.split_once(':')?;
    let mut chars = head.chars();
    let first = chars.next()?;
    let valid = head.len() >= 2
        && first.is_ascii_alphabetic()
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    valid.then_some(head)
}

/// A path as a `/`-separated string, the form every path glob matches.
pub(crate) fn path_key(p: &Path) -> String {
    let s = p.to_string_lossy();
    if cfg!(windows) {
        s.replace('\\', "/")
    } else {
        s.into_owned()
    }
}

/// True when `child` is `parent` or lies below it (both `/`-separated keys).
pub(crate) fn is_within(child: &str, parent: &str) -> bool {
    match child.strip_prefix(parent) {
        Some("") => true,
        Some(rest) => parent.ends_with('/') || rest.starts_with('/'),
        None => false,
    }
}

/// Which namespace a resource glob lives in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Space {
    Path,
    Url,
}

/// A compiled resource glob from a grant or a Charter rule.
#[derive(Debug)]
pub(crate) struct ResourceGlob {
    space: Space,
    matcher: GlobMatcher,
    /// For a glob ending in `/**`, the directory itself, which users expect
    /// to be included (a Notes grant covers listing `~/Notes`).
    dir: Option<GlobMatcher>,
    /// Lowercased literal directory every match lies under (path globs only).
    root: Option<String>,
}

impl ResourceGlob {
    /// Compiles `pattern`. Path globs expand `~` and relative forms against
    /// `home` exactly as `path::resolve` does for arguments.
    pub(crate) fn compile(home: &Path, pattern: &str, mode: Mode) -> Result<Self, String> {
        let pattern = pattern.trim();
        if pattern.is_empty() {
            return Err("empty resource glob".into());
        }
        if scheme(pattern).is_some() {
            let fold = mode == Mode::Restrict;
            return Ok(Self {
                space: Space::Url,
                matcher: build(pattern, true, fold)?,
                dir: dir_matcher(pattern, fold)?,
                root: None,
            });
        }
        if pattern.contains("://") {
            return Err(format!(
                "URL glob `{pattern}` must start with a literal scheme such as https://"
            ));
        }
        if pattern.split(is_separator).any(|part| part == "..") {
            // `..` would make the glob broader than it reads.
            return Err(format!("`..` is not allowed in resource glob `{pattern}`"));
        }
        let fold = mode == Mode::Restrict || FOLDS_CASE;
        // Escape the home directory so a `[` or `{` in a user name stays literal.
        let escaped_home = globset::escape(&home.to_string_lossy());
        let key = path_key(&resolve(Path::new(&escaped_home), pattern));
        Ok(Self {
            space: Space::Path,
            matcher: build(&key, true, fold)?,
            dir: dir_matcher(&key, fold)?,
            root: Some(path_key(&resolve(home, literal_prefix(pattern))).to_lowercase()),
        })
    }

    fn is_match(&self, key: &str) -> bool {
        self.matcher.is_match(key) || self.dir.as_ref().is_some_and(|d| d.is_match(key))
    }

    /// Permissive match: only the value's primary reading counts (a URL for
    /// URL-shaped values, a path otherwise).
    pub(crate) fn permits(&self, r: &Resource) -> bool {
        match (self.space, &r.url) {
            (Space::Url, Some(web)) => self.is_match(&web.key),
            (Space::Path, None) => self.is_match(&r.path),
            _ => false,
        }
    }

    /// Restrictive match: any reading of the value counts, since an Organ
    /// might treat a URL-shaped string as a path. With `reach`, a path that
    /// contains this glob's root also matches, because moving, copying or
    /// deleting a directory acts on everything inside it.
    pub(crate) fn restricts(&self, r: &Resource, reach: bool) -> bool {
        match self.space {
            Space::Url => r.url.as_ref().is_some_and(|web| self.is_match(&web.key)),
            Space::Path => {
                self.is_match(&r.path)
                    || (reach
                        && self
                            .root
                            .as_deref()
                            .is_some_and(|root| is_within(root, &r.path.to_lowercase())))
            }
        }
    }
}

fn dir_matcher(key: &str, fold: bool) -> Result<Option<GlobMatcher>, String> {
    match key.strip_suffix("/**") {
        Some(base) if !base.is_empty() && !base.ends_with('/') => {
            Ok(Some(build(base, true, fold)?))
        }
        _ => Ok(None),
    }
}

/// The part of `pattern` before the first component containing a glob
/// metacharacter, e.g. `~/Secret/` for `~/Secret/**`.
fn literal_prefix(pattern: &str) -> &str {
    let mut start = 0;
    for (i, c) in pattern.char_indices() {
        if is_separator(c) {
            start = i + c.len_utf8();
        } else if META.contains(&c) {
            return &pattern[..start];
        }
    }
    pattern
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheme_detection() {
        assert_eq!(scheme("https://x"), Some("https"));
        assert_eq!(scheme("HTTP://x"), Some("HTTP"));
        assert_eq!(scheme("file:///etc"), Some("file"));
        assert_eq!(scheme("javascript:alert(1)"), Some("javascript"));
        assert_eq!(scheme("svn+ssh://h"), Some("svn+ssh"));
        assert_eq!(scheme("localhost:8080"), Some("localhost"));
        assert_eq!(scheme(r"C:\Users"), None, "drive letter");
        assert_eq!(scheme("C:/Users"), None, "drive letter");
        assert_eq!(scheme("~/a:b"), None);
        assert_eq!(scheme("./a:b"), None);
        assert_eq!(scheme("a/b:c"), None);
        assert_eq!(scheme("1http://x"), None);
        assert_eq!(scheme(":x"), None);
        assert_eq!(scheme("no colon"), None);
    }

    #[test]
    fn within_is_component_wise() {
        assert!(is_within("/a/b", "/a/b"));
        assert!(is_within("/a/b/c", "/a/b"));
        assert!(!is_within("/a/bc", "/a/b"));
        assert!(!is_within("/a", "/a/b"));
        assert!(is_within("/x", "/"));
        assert!(is_within("c:/x", "c:/"));
    }

    #[test]
    fn literal_prefixes() {
        assert_eq!(literal_prefix("~/Secret/**"), "~/Secret/");
        assert_eq!(literal_prefix("~/Secret/*.txt"), "~/Secret/");
        assert_eq!(literal_prefix("/etc/passwd"), "/etc/passwd");
        assert_eq!(literal_prefix("/**"), "/");
        assert_eq!(literal_prefix("**"), "");
        assert_eq!(literal_prefix("~/a{b,c}/d"), "~/");
        assert_eq!(literal_prefix("~/é[x]"), "~/");
    }

    #[test]
    fn name_globs() {
        let m = name_glob("fs.*", Mode::Permit).unwrap();
        assert!(m.is_match("fs.read"));
        assert!(!m.is_match("FS.read"));
        assert!(!m.is_match("net.fetch"));
        let r = name_glob(" FS.* ", Mode::Restrict).unwrap();
        assert!(r.is_match("fs.read"));
        // `*` crosses `/` in names so odd third-party tool names stay covered.
        assert!(
            name_glob("srv.*", Mode::Restrict)
                .unwrap()
                .is_match("srv.a/b")
        );
        assert!(name_glob("  ", Mode::Permit).is_err());
        assert!(name_glob("fs.[", Mode::Permit).is_err());
        assert!(
            domain_glob("*.Wikipedia.org.")
                .unwrap()
                .is_match("en.wikipedia.org")
        );
    }

    #[test]
    fn url_globs_need_a_literal_scheme() {
        let home = Path::new("/home/u");
        assert!(ResourceGlob::compile(home, "[h]ttps://x/**", Mode::Restrict).is_err());
        assert!(ResourceGlob::compile(home, "~/../**", Mode::Permit).is_err());
        assert!(ResourceGlob::compile(home, "", Mode::Permit).is_err());
        assert!(ResourceGlob::compile(home, "https://x/[", Mode::Permit).is_err());
        assert!(ResourceGlob::compile(home, "~/x/[", Mode::Permit).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn home_metacharacters_stay_literal() {
        let home = Path::new("/home/a[b]{c}*");
        let g = ResourceGlob::compile(home, "~/Notes/**", Mode::Permit).unwrap();
        let hit = Resource::path_only("/home/a[b]{c}*/Notes/x.md");
        let miss = Resource::path_only("/home/ab{c}x/Notes/x.md");
        assert!(g.permits(&hit));
        assert!(!g.permits(&miss));
        let r = ResourceGlob::compile(home, "~/Secret/**", Mode::Restrict).unwrap();
        assert!(r.restricts(&Resource::path_only("/home/a[b]{c}*"), true));
    }

    #[cfg(unix)]
    #[test]
    fn dir_itself_and_depth() {
        let home = Path::new("/home/u");
        let deep = ResourceGlob::compile(home, "~/Notes/**", Mode::Permit).unwrap();
        let flat = ResourceGlob::compile(home, "~/Notes/*", Mode::Permit).unwrap();
        let p = |s: &str| Resource::path_only(s);
        assert!(deep.permits(&p("/home/u/Notes")));
        assert!(deep.permits(&p("/home/u/Notes/a.md")));
        assert!(deep.permits(&p("/home/u/Notes/sub/a.md")));
        assert!(!deep.permits(&p("/home/u/NotesEvil/a.md")));
        assert!(!flat.permits(&p("/home/u/Notes")));
        assert!(flat.permits(&p("/home/u/Notes/a.md")));
        assert!(!flat.permits(&p("/home/u/Notes/sub/a.md")));
        // `/**` alone has no directory part to add.
        let all = ResourceGlob::compile(home, "/**", Mode::Permit).unwrap();
        assert!(all.dir.is_none());
        assert!(all.permits(&p("/etc/passwd")));
    }
}
