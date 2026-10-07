//! Turns resource arguments into the paths and URLs the Warden checks.
//!
//! Every value gets a path reading (`path::resolve`), because a path-taking
//! Organ would touch exactly that. URL-shaped values also get a URL reading,
//! parsed with the same WHATWG parser the network Organ uses so both sides
//! agree on the host.

use percent_encoding::percent_decode_str;
use serde_json::Value;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::{Component, Path, Prefix};
use url::{Host, Url};
use xz_types::ToolSpec;
use xz_types::path::resolve;

use crate::glob::{path_key, scheme};

/// One resource argument, read every way an Organ might read it.
#[derive(Debug)]
pub(crate) struct Resource {
    /// The value as the Organism sent it, for messages.
    pub raw: String,
    /// `path::resolve(home, raw)` as a `/`-separated key.
    pub path: String,
    /// The http(s) reading of a URL-shaped value.
    pub url: Option<WebTarget>,
}

/// A normalized http(s) URL.
#[derive(Debug)]
pub(crate) struct WebTarget {
    /// `scheme://host[:port]/decoded-path`, the form URL globs match.
    pub key: String,
    pub host: Target,
}

/// Where a URL points.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Target {
    /// Lowercase, punycode, without a trailing dot.
    Domain(String),
    V4(Ipv4Addr),
    V6(Ipv6Addr),
}

/// Network zone of a host, which decides the egress check.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Zone {
    Localhost,
    Lan,
    /// A public IP literal.
    PublicIp,
    /// A domain name, checked against the Charter's allowlist.
    Domain,
}

/// Reads every resource argument `spec` declares. Errors are deny reasons.
pub(crate) fn collect(spec: &ToolSpec, args: &Value, home: &Path) -> Result<Vec<Resource>, String> {
    spec.resource_args
        .iter()
        .map(|name| match args.get(name) {
            None | Some(Value::Null) => Err(format!("missing resource argument `{name}`")),
            Some(Value::String(raw)) => read(home, name, raw),
            Some(_) => Err(format!("resource argument `{name}` must be a string")),
        })
        .collect()
}

fn read(home: &Path, name: &str, raw: &str) -> Result<Resource, String> {
    if raw.is_empty() {
        return Err(format!("resource argument `{name}` is empty"));
    }
    // URL parsers strip surrounding whitespace and drop tabs and newlines,
    // so `" https://x"` would be a path here and a URL in the Organ.
    let trimmed = raw.trim() != raw;
    if trimmed || raw.chars().any(char::is_control) {
        return Err(format!(
            "resource argument `{name}` has surrounding whitespace or control characters"
        ));
    }
    let path = resolve(home, raw);
    if !path.is_absolute() {
        return Err(format!("`{raw}` does not resolve to an absolute path"));
    }
    let url = match scheme(raw) {
        Some(s) => Some(web_target(raw, s)?),
        None => {
            if cfg!(windows) {
                if let Some(why) = windows_hazard(&path) {
                    return Err(format!("`{raw}` is ambiguous on Windows: {why}"));
                }
            }
            None
        }
    };
    Ok(Resource {
        raw: raw.to_owned(),
        path: path_key(&path),
        url,
    })
}

fn has_dot_segment(s: &str) -> bool {
    s.split(['/', '\\']).any(|seg| seg == "." || seg == "..")
}

fn web_target(raw: &str, scheme: &str) -> Result<WebTarget, String> {
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return Err(format!(
            "URL scheme `{scheme}:` is not allowed; only http and https"
        ));
    }
    // Dot segments in the raw text would let the path reading of the same
    // string climb out of the directory the URL reading suggests.
    if has_dot_segment(raw) {
        return Err(format!("URL `{raw}` contains `.` or `..` segments"));
    }
    let url = Url::parse(raw).map_err(|e| format!("malformed URL `{raw}`: {e}"))?;
    let host = match url.host() {
        Some(Host::Domain(d)) => {
            let d = d.trim_end_matches('.');
            if d.is_empty() {
                return Err(format!("URL `{raw}` has an empty host"));
            }
            Target::Domain(d.to_ascii_lowercase())
        }
        Some(Host::Ipv4(a)) => Target::V4(a),
        Some(Host::Ipv6(a)) => Target::V6(a),
        None => return Err(format!("URL `{raw}` has no host")),
    };
    // Servers decode the path, so globs and dot checks see it decoded.
    let path = percent_decode_str(url.path()).decode_utf8_lossy();
    if has_dot_segment(&path) {
        return Err(format!("URL `{raw}` contains encoded `.` or `..` segments"));
    }
    let host_str = match &host {
        Target::Domain(d) => d.clone(),
        Target::V4(a) => a.to_string(),
        Target::V6(a) => format!("[{a}]"),
    };
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    Ok(WebTarget {
        key: format!("{}://{host_str}{port}{path}", url.scheme()),
        host,
    })
}

impl Target {
    /// The display form used in messages.
    pub(crate) fn name(&self) -> String {
        match self {
            Target::Domain(d) => d.clone(),
            Target::V4(a) => a.to_string(),
            Target::V6(a) => a.to_string(),
        }
    }

    pub(crate) fn zone(&self) -> Zone {
        match self {
            Target::Domain(d) if d == "localhost" || d.ends_with(".localhost") => Zone::Localhost,
            Target::Domain(_) => Zone::Domain,
            Target::V4(a) => zone_v4(*a),
            Target::V6(a) => zone_v6(*a),
        }
    }
}

fn zone_v4(ip: Ipv4Addr) -> Zone {
    match ip.octets() {
        // 0.0.0.0/8 reaches the local host on common stacks.
        [127 | 0, ..] => Zone::Localhost,
        [10, ..] | [192, 168, ..] | [169, 254, ..] => Zone::Lan,
        [172, 16..=31, ..] => Zone::Lan,
        // Carrier-grade NAT space, also used by mesh VPNs for peers.
        [100, 64..=127, ..] => Zone::Lan,
        _ => Zone::PublicIp,
    }
}

fn zone_v6(ip: Ipv6Addr) -> Zone {
    if ip.is_loopback() || ip.is_unspecified() {
        return Zone::Localhost;
    }
    if let Some(v4) = ip.to_ipv4_mapped() {
        return zone_v4(v4);
    }
    let seg = ip.segments();
    if let [0, 0, 0, 0, 0, 0, hi, lo] = seg {
        // Deprecated IPv4-compatible form `::a.b.c.d`.
        return zone_v4(Ipv4Addr::from((u32::from(hi) << 16) | u32::from(lo)));
    }
    // fc00::/7 unique local, fe80::/10 link local, fec0::/10 site local.
    if seg[0] & 0xfe00 == 0xfc00 || seg[0] & 0xffc0 == 0xfe80 || seg[0] & 0xffc0 == 0xfec0 {
        return Zone::Lan;
    }
    Zone::PublicIp
}

/// Path spellings Windows silently rewrites or routes elsewhere, so a
/// lexical check could approve one name while the OS opens another.
pub(crate) fn windows_hazard(path: &Path) -> Option<&'static str> {
    for c in path.components() {
        match c {
            Component::Prefix(p) if !matches!(p.kind(), Prefix::Disk(_)) => {
                return Some("network, device and verbatim paths are not allowed");
            }
            Component::Normal(name) => {
                if let Some(why) = windows_name_hazard(&name.to_string_lossy()) {
                    return Some(why);
                }
            }
            _ => {}
        }
    }
    None
}

/// Checks one path component against Windows name rewriting.
pub(crate) fn windows_name_hazard(name: &str) -> Option<&'static str> {
    if name.ends_with('.') || name.ends_with(' ') {
        return Some("Windows drops trailing dots and spaces");
    }
    if name.contains(':') {
        return Some("alternate data streams are not allowed");
    }
    let bytes = name.as_bytes();
    if bytes
        .windows(2)
        .any(|w| w[0] == b'~' && w[1].is_ascii_digit())
    {
        return Some("8.3 short names are not allowed");
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or(name)
        .trim_end()
        .to_uppercase();
    let reserved = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|dev| {
        stem.strip_prefix(dev).is_some_and(|n| {
            matches!(
                n,
                "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    });
    reserved.then_some("reserved device names are not allowed")
}

#[cfg(all(test, unix))]
impl Resource {
    /// A plain path resource, for glob tests.
    pub(crate) fn path_only(path: &str) -> Self {
        Self {
            raw: path.into(),
            path: path.into(),
            url: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use xz_types::Risk;

    fn spec(args: &[&str]) -> ToolSpec {
        ToolSpec {
            name: "t.t".into(),
            description: String::new(),
            input_schema: json!({}),
            risk: Risk::Observe,
            resource_args: args.iter().map(|s| s.to_string()).collect(),
            tainted_output: false,
            first_party: true,
        }
    }

    fn home() -> &'static Path {
        Path::new(if cfg!(windows) {
            r"C:\Users\u"
        } else {
            "/home/u"
        })
    }

    fn one(raw: &str) -> Result<Resource, String> {
        collect(&spec(&["r"]), &json!({ "r": raw }), home()).map(|mut v| v.remove(0))
    }

    fn url_key(raw: &str) -> String {
        one(raw).unwrap().url.unwrap().key
    }

    #[test]
    fn malformed_arguments() {
        let s = spec(&["path"]);
        let err = |args: Value| collect(&s, &args, home()).unwrap_err();
        assert!(err(json!({})).contains("missing"));
        assert!(err(json!({ "path": null })).contains("missing"));
        assert!(err(json!("not an object")).contains("missing"));
        assert!(err(json!({ "path": 5 })).contains("must be a string"));
        assert!(err(json!({ "path": ["~/a"] })).contains("must be a string"));
        assert!(err(json!({ "path": { "p": "~/a" } })).contains("must be a string"));
        assert!(err(json!({ "path": true })).contains("must be a string"));
        assert!(err(json!({ "path": "" })).contains("empty"));
        assert!(err(json!({ "path": " https://evil.com" })).contains("whitespace"));
        assert!(err(json!({ "path": "~/a " })).contains("whitespace"));
        assert!(err(json!({ "path": "ht\ttps://evil.com" })).contains("control"));
        assert!(err(json!({ "path": "~/a\nb" })).contains("control"));
        assert!(err(json!({ "path": "~/a\u{0}b" })).contains("control"));
        // A tool without resource args ignores args entirely.
        assert!(
            collect(&spec(&[]), &json!(null), home())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn relative_home_is_refused() {
        let err = collect(&spec(&["p"]), &json!({"p": "a"}), Path::new("rel")).unwrap_err();
        assert!(err.contains("absolute"));
    }

    #[test]
    fn schemes_other_than_http_are_denied() {
        for raw in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>",
            "ftp://h/x",
            "mailto:a@b.c",
            "localhost:8080",
            "notes:today.md",
        ] {
            assert!(one(raw).unwrap_err().contains("scheme"), "{raw}");
        }
    }

    #[test]
    fn url_normalization() {
        assert_eq!(
            url_key("HTTPS://EN.Wikipedia.ORG/wiki/X"),
            "https://en.wikipedia.org/wiki/X"
        );
        assert_eq!(
            url_key("https://en.wikipedia.org./wiki"),
            "https://en.wikipedia.org/wiki"
        );
        assert_eq!(url_key("https://x.org:443/a"), "https://x.org/a");
        assert_eq!(url_key("http://x.org:8080/a?q=1#f"), "http://x.org:8080/a");
        assert_eq!(
            url_key("https://x.org/%70rivate/a%20b"),
            "https://x.org/private/a b"
        );
        assert_eq!(url_key("https:evil.com"), "https://evil.com/");
        // Userinfo never reaches the key; the real host does.
        assert_eq!(
            url_key("https://en.wikipedia.org@evil.com/x"),
            "https://evil.com/x"
        );
        // WHATWG treats `\` as `/` in http(s) URLs.
        assert_eq!(
            url_key(r"https://evil.com\.wikipedia.org/"),
            "https://evil.com/.wikipedia.org/"
        );
        assert_eq!(url_key("http://[::1]:8080/"), "http://[::1]:8080/");
        assert_eq!(url_key("http://0x7f000001/"), "http://127.0.0.1/");
        assert_eq!(url_key("http://2130706433/"), "http://127.0.0.1/");
        // IDN homographs show up as punycode.
        let cyr = one("https://wikipediа.org/").unwrap().url.unwrap();
        assert!(cyr.host.name().starts_with("xn--"));
    }

    #[test]
    fn url_dot_segments_and_bad_hosts() {
        for raw in [
            "https://h/../../../.xindoze/charter.toml",
            "https://h/a/./b",
            r"https://h\..\x",
            "https://h/a/..",
        ] {
            assert!(one(raw).unwrap_err().contains("segments"), "{raw}");
        }
        // The parser itself resolves `%2e` segments, exactly as the Organ will.
        assert_eq!(url_key("https://h/p/%2e%2e/x"), "https://h/x");
        assert_eq!(url_key("https://h/%2E/x"), "https://h/x");
        // Encoded separators survive parsing; servers decode them later.
        for raw in [
            "https://h/a%2f..%2fb",
            "https://h/a%5c..%5cb",
            "https://h/%2e%2e%2fx",
        ] {
            assert!(one(raw).unwrap_err().contains("encoded"), "{raw}");
        }
        assert!(
            one("https://evil.com%2f.x.org/")
                .unwrap_err()
                .contains("malformed")
        );
        assert!(one("http://").unwrap_err().contains("malformed"));
        assert!(one("https://x:99999/").unwrap_err().contains("malformed"));
        assert!(one("http://./").is_err());
        // The parser accepts dot-only hosts; trimming the root dot empties them.
        assert!(one("http://.../").unwrap_err().contains("empty host"));
        assert!(one("http://%2e/").unwrap_err().contains("empty host"));
    }

    #[test]
    fn url_path_reading_is_confined() {
        let r = one("https://h/x").unwrap();
        let home = path_key(home());
        assert!(r.path.starts_with(&home));
        assert!(r.path.contains("https:"));
    }

    #[test]
    fn zones() {
        let z = |raw: &str| one(raw).unwrap().url.unwrap().host.zone();
        assert_eq!(z("http://localhost:3000/"), Zone::Localhost);
        assert_eq!(z("http://LOCALHOST./"), Zone::Localhost);
        assert_eq!(z("http://app.localhost/"), Zone::Localhost);
        assert_eq!(z("http://127.0.0.1/"), Zone::Localhost);
        assert_eq!(z("http://127.255.1.2/"), Zone::Localhost);
        assert_eq!(z("http://0.0.0.0:8080/"), Zone::Localhost);
        assert_eq!(z("http://[::1]/"), Zone::Localhost);
        assert_eq!(z("http://[::]/"), Zone::Localhost);
        assert_eq!(z("http://[::ffff:127.0.0.1]/"), Zone::Localhost);
        assert_eq!(z("http://[::127.0.0.1]/"), Zone::Localhost);
        for lan in [
            "http://10.0.0.1/",
            "http://172.16.0.1/",
            "http://172.31.255.255/",
            "http://192.168.1.10/",
            "http://169.254.169.254/",
            "http://100.64.0.1/",
            "http://100.127.255.255/",
            "http://[fd00::1]/",
            "http://[fc00::1]/",
            "http://[fe80::1]/",
            "http://[fec0::1]/",
            "http://[::ffff:192.168.0.1]/",
            "http://0300.0250.0.1/",
        ] {
            assert_eq!(z(lan), Zone::Lan, "{lan}");
        }
        for public in [
            "http://8.8.8.8/",
            "http://172.32.0.1/",
            "http://172.15.0.1/",
            "http://100.128.0.1/",
            "http://192.169.0.1/",
            "http://[2001:db8::1]/",
            "http://[::ffff:8.8.8.8]/",
            "http://[64:ff9b::7f00:1]/",
            "http://224.0.0.1/",
        ] {
            assert_eq!(z(public), Zone::PublicIp, "{public}");
        }
        assert_eq!(z("https://example.com/"), Zone::Domain);
        assert_eq!(z("https://localhost.evil.com/"), Zone::Domain);
        assert_eq!(z("https://notlocalhost/"), Zone::Domain);
    }

    #[test]
    fn target_names() {
        assert_eq!(Target::Domain("a.b".into()).name(), "a.b");
        assert_eq!(Target::V4(Ipv4Addr::LOCALHOST).name(), "127.0.0.1");
        assert_eq!(Target::V6(Ipv6Addr::LOCALHOST).name(), "::1");
    }

    #[test]
    fn windows_names() {
        let h = windows_name_hazard;
        assert_eq!(h("notes.md"), None);
        assert_eq!(h("my~file.txt"), None);
        assert_eq!(h("CONSOLE.txt"), None);
        assert_eq!(h("COM10"), None);
        assert_eq!(h("LPT"), None);
        assert!(h("xindoze.").is_some());
        assert!(h("xindoze ").is_some());
        assert!(h("charter.toml:$DATA").is_some());
        assert!(h("XINDOZ~1").is_some());
        assert!(h("PROGRA~2").is_some());
        for dev in [
            "CON", "con.txt", "Nul", "AUX.md", "PRN", "COM1", "lpt9.log", "COM¹", "CONIN$",
            "NUL .txt",
        ] {
            assert!(h(dev).is_some(), "{dev}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn windows_hazard_walks_components() {
        assert_eq!(windows_hazard(Path::new("/home/u/ok.md")), None);
        assert!(windows_hazard(Path::new("/home/u/bad./x")).is_some());
    }

    #[cfg(windows)]
    #[test]
    fn windows_prefixes() {
        assert_eq!(windows_hazard(Path::new(r"C:\Users\u\a.md")), None);
        for p in [
            r"\\server\share\x",
            r"\\?\C:\Users\u\a",
            r"\\.\PhysicalDrive0",
            r"\\?\UNC\s\x",
        ] {
            assert!(windows_hazard(Path::new(p)).is_some(), "{p}");
        }
        assert!(one(r"\\server\share\x").is_err());
        assert!(one(r"C:\Users\u\AppData\xindoze.\charter.toml").is_err());
        assert!(one(r"C:foo").is_err(), "drive-relative path");
    }
}
