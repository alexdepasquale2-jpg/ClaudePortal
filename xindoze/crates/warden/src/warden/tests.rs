//! Decision matrix tests for the Warden.

use super::*;
use crate::charter::When;
use serde_json::json;
use std::sync::Arc;

const ORG: &str = "xindoze.notes";

fn home() -> PathBuf {
    PathBuf::from(if cfg!(windows) {
        r"C:\Users\u"
    } else {
        "/home/u"
    })
}

fn warden_with(charter: Charter) -> Warden {
    Warden::new(charter, home(), home().join(".xindoze")).unwrap()
}

fn warden() -> Warden {
    warden_with(Charter::default())
}

fn spec(name: &str, risk: Risk, resources: &[&str], first_party: bool) -> ToolSpec {
    ToolSpec {
        name: name.into(),
        description: String::new(),
        input_schema: json!({}),
        risk,
        resource_args: resources.iter().map(|s| s.to_string()).collect(),
        tainted_output: false,
        first_party,
    }
}

fn tool(name: &str, risk: Risk, resources: &[&str]) -> ToolSpec {
    spec(name, risk, resources, true)
}

fn fs_read() -> ToolSpec {
    tool("fs.read", Risk::Observe, &["path"])
}
fn fs_list() -> ToolSpec {
    tool("fs.list", Risk::Observe, &["path"])
}
fn fs_write() -> ToolSpec {
    tool("fs.write", Risk::Act, &["path"])
}
fn fs_trash() -> ToolSpec {
    tool("fs.trash", Risk::Act, &["path"])
}
fn fs_move() -> ToolSpec {
    tool("fs.move", Risk::Act, &["from", "to"])
}
fn net_fetch() -> ToolSpec {
    tool("net.fetch", Risk::Observe, &["url"])
}
fn net_post() -> ToolSpec {
    tool("net.post", Risk::Commit, &["url"])
}

fn grant(tool: &str, resources: &[&str]) -> Grant {
    Grant {
        tool: tool.into(),
        resources: resources.iter().map(|s| s.to_string()).collect(),
    }
}

fn any(tool: &str) -> Vec<Grant> {
    vec![grant(tool, &[])]
}

fn rule(id: &str, tool: &str, resource: Option<&str>, decision: Policy) -> Rule {
    Rule {
        id: id.into(),
        text: String::new(),
        subject: "*".into(),
        tool: tool.into(),
        resource: resource.map(String::from),
        decision,
        when: None,
    }
}

fn charter_with(rules: Vec<Rule>) -> Charter {
    Charter {
        rules,
        ..Charter::default()
    }
}

fn web(source: &str) -> Taint {
    Taint::from_source(source)
}

fn call_as(
    w: &Warden,
    organism: &str,
    grants: &[Grant],
    spec: &ToolSpec,
    args: Value,
    taint: &Taint,
) -> Decision {
    w.decide(&Request {
        organism,
        grants,
        spec,
        args: &args,
        taint,
    })
}

fn call(w: &Warden, grants: &[Grant], spec: &ToolSpec, args: Value) -> Decision {
    call_as(w, ORG, grants, spec, args, &Taint::none())
}

fn path(p: &str) -> Value {
    json!({ "path": p })
}

fn url(u: &str) -> Value {
    json!({ "url": u })
}

#[track_caller]
fn allow(d: Decision) {
    assert_eq!(d, Decision::Allow);
}

#[track_caller]
fn ask(d: Decision, needle: &str) {
    match d {
        Decision::Ask { reason } => assert!(
            reason.contains(needle),
            "ask reason {reason:?} lacks {needle:?}"
        ),
        other => panic!("expected Ask({needle}), got {other:?}"),
    }
}

#[track_caller]
fn deny(d: Decision, needle: &str) {
    match d {
        Decision::Deny { reason } => assert!(
            reason.contains(needle),
            "deny reason {reason:?} lacks {needle:?}"
        ),
        other => panic!("expected Deny({needle}), got {other:?}"),
    }
}

// ---- a. grants ----

#[test]
fn tool_must_be_granted() {
    let w = warden();
    let s = tool("sys.info", Risk::Observe, &[]);
    deny(call(&w, &[], &s, json!({})), "not granted");
    deny(
        call(&w, &any("net.*"), &s, json!({})),
        "has no capability for sys.info",
    );
    deny(call(&w, &any("SYS.info"), &s, json!({})), "not granted");
    deny(call(&w, &any("sys.["), &s, json!({})), "not granted");
    allow(call(&w, &any("sys.info"), &s, json!({})));
    allow(call(&w, &any("sys.*"), &s, json!({})));
    allow(call(&w, &any("*"), &s, json!({})));
}

#[test]
fn grant_globs_resolve_against_home() {
    let w = warden();
    let g = vec![grant("fs.read", &["~/Notes/**"])];
    let read = |p: &str| call(&w, &g, &fs_read(), path(p));
    allow(read("~/Notes/a.md"));
    allow(read("Notes/a.md"));
    allow(read("~/Notes/./a.md"));
    allow(read("~/Notes/sub/../b.md"));
    allow(read("~/Notes/deep/er/c.md"));
    allow(read("~/Notes"));
    allow(read("~/Notes/"));
    deny(read("~/NotesX/a.md"), "not granted");
    deny(read("~/Notes/../Secret.md"), "not granted");
    deny(read("~"), "not granted");
    deny(read("~/a.md"), "may not use fs.read on ~/a.md");
}

#[cfg(unix)]
#[test]
fn path_traversal_is_normalized_before_matching() {
    let w = warden();
    let g = vec![grant("fs.read", &["~/Notes/**"])];
    let read = |p: &str| call(&w, &g, &fs_read(), path(p));
    allow(read("/home/u/Notes/a.md"));
    allow(read("../u/Notes/a.md"));
    allow(read("/home/./u//Notes/a.md"));
    deny(read("~/Notes/../../etc/passwd"), "not granted");
    deny(read("~/Notes/../../../../../../etc/passwd"), "not granted");
    deny(read("/home/u/Notes/../../../etc/passwd"), "not granted");
    deny(read("Notes/../../../etc/shadow"), "not granted");
    deny(read("/etc/passwd"), "not granted");
    deny(read("/../home/u/Notes/../../../etc/passwd"), "not granted");
}

#[cfg(unix)]
#[test]
fn normalization_is_lexical_and_ignores_the_filesystem() {
    // A real symlink inside a granted folder: the Warden judges the name,
    // not the target, and needs nothing to exist on disk.
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().to_path_buf();
    std::fs::create_dir(home.join("Notes")).unwrap();
    std::os::unix::fs::symlink("/etc", home.join("Notes").join("link")).unwrap();
    let w = Warden::new(Charter::default(), home.clone(), home.join(".xindoze")).unwrap();
    let g = vec![grant("fs.read", &["~/Notes/**"])];
    allow(call(&w, &g, &fs_read(), path("~/Notes/link/passwd")));
    allow(call(
        &w,
        &g,
        &fs_read(),
        path("~/Notes/missing/deep/file.md"),
    ));
    deny(
        call(&w, &g, &fs_read(), path("~/Notes/link/../../x")),
        "not granted",
    );
    assert!(!home.join("Notes").join("missing").exists());
}

#[test]
fn star_versus_double_star() {
    let w = warden();
    let flat = vec![grant("fs.read", &["~/Notes/*"])];
    allow(call(&w, &flat, &fs_read(), path("~/Notes/a.md")));
    deny(
        call(&w, &flat, &fs_read(), path("~/Notes/sub/a.md")),
        "not granted",
    );
    deny(call(&w, &flat, &fs_read(), path("~/Notes")), "not granted");

    let md = vec![grant("fs.read", &["~/**/*.md"])];
    allow(call(&w, &md, &fs_read(), path("~/x/y/z.md")));
    allow(call(&w, &md, &fs_read(), path("~/z.md")));
    deny(
        call(&w, &md, &fs_read(), path("~/x/y/z.txt")),
        "not granted",
    );

    let top = vec![grant("fs.read", &["~/*.md"])];
    allow(call(&w, &top, &fs_read(), path("~/a.md")));
    deny(call(&w, &top, &fs_read(), path("~/x/a.md")), "not granted");

    let braces = vec![grant("fs.read", &["~/{Notes,Docs}/**"])];
    allow(call(&w, &braces, &fs_read(), path("~/Docs/a")));
    deny(
        call(&w, &braces, &fs_read(), path("~/Music/a")),
        "not granted",
    );
}

#[cfg(unix)]
#[test]
fn relative_and_absolute_grant_globs() {
    let w = warden();
    // A relative glob is relative to home, like a relative argument.
    let rel = vec![grant("fs.read", &["**"])];
    allow(call(&w, &rel, &fs_read(), path("~/anything/at/all")));
    deny(
        call(&w, &rel, &fs_read(), path("/etc/passwd")),
        "not granted",
    );
    let root = vec![grant("fs.read", &["/**"])];
    allow(call(&w, &root, &fs_read(), path("/etc/passwd")));
    let exact = vec![grant("fs.read", &["/etc/hosts"])];
    allow(call(&w, &exact, &fs_read(), path("/etc/hosts")));
    deny(
        call(&w, &exact, &fs_read(), path("/etc/hosts.bak")),
        "not granted",
    );
}

#[test]
fn matching_grants_are_unioned() {
    let w = warden();
    let g = vec![
        grant("fs.read", &["~/Notes/**"]),
        grant("fs.*", &["~/Docs/**"]),
    ];
    allow(call(&w, &g, &fs_read(), path("~/Docs/a")));
    allow(call(&w, &g, &fs_read(), path("~/Notes/a")));
    deny(call(&w, &g, &fs_read(), path("~/Music/a")), "not granted");
    // A non-matching grant's resources do not leak into another tool.
    let g = vec![
        grant("fs.read", &["~/**"]),
        grant("fs.write", &["~/Out/**"]),
    ];
    deny(call(&w, &g, &fs_write(), path("~/In/a")), "not granted");
    // Any matching grant without resources covers everything.
    let g = vec![grant("fs.read", &["~/Notes/**"]), grant("fs.*", &[])];
    allow(call(&w, &g, &fs_read(), path("~/Music/a")));
}

#[test]
fn invalid_grant_globs_never_match() {
    let w = warden();
    for bad in ["~/Notes/[", "~/Notes/../**", "[h]ttps://x/**", "   "] {
        let g = vec![grant("fs.read", &[bad])];
        deny(call(&w, &g, &fs_read(), path("~/Notes/a")), "not granted");
    }
}

#[test]
fn grants_ignore_unrelated_resources_for_resourceless_tools() {
    let w = warden();
    let g = vec![grant("proc.*", &["~/x"])];
    allow(call(
        &w,
        &g,
        &tool("proc.list", Risk::Observe, &[]),
        json!({}),
    ));
}

// ---- b. malformed arguments ----

#[test]
fn malformed_resource_arguments_are_denied() {
    let w = warden();
    let g = any("fs.*");
    deny(
        call(&w, &g, &fs_read(), json!({})),
        "missing resource argument `path`",
    );
    deny(call(&w, &g, &fs_read(), json!({ "path": null })), "missing");
    deny(call(&w, &g, &fs_read(), json!(["~/a"])), "missing");
    deny(
        call(&w, &g, &fs_read(), json!({ "path": 7 })),
        "must be a string",
    );
    deny(
        call(&w, &g, &fs_read(), json!({ "path": ["~/a", "~/b"] })),
        "must be a string",
    );
    deny(
        call(&w, &g, &fs_read(), json!({ "path": {"p": "~/a"} })),
        "must be a string",
    );
    deny(call(&w, &g, &fs_read(), json!({ "path": "" })), "empty");
    deny(
        call(&w, &g, &fs_read(), json!({ "path": "~/a\n" })),
        "whitespace or control",
    );
    // One bad argument spoils the call even when the other is fine.
    deny(
        call(&w, &g, &fs_move(), json!({ "from": "~/a", "to": 1 })),
        "`to` must be a string",
    );
    deny(
        call(&w, &g, &fs_move(), json!({ "from": "~/a" })),
        "missing resource argument `to`",
    );
}

// ---- data directory ----

#[test]
fn data_dir_is_never_reachable() {
    let w = warden();
    let everything = vec![grant("*", &[]), grant("fs.read", &["/**", "~/**"])];
    for p in [
        "~/.xindoze",
        "~/.xindoze/",
        "~/.xindoze/engram.db",
        "~/.xindoze/charter.toml",
        "~/.xindoze/trash/t1/0-a.md",
        "~/.XINDOZE/engram.db",
        "~/.Xindoze/Charter.toml",
        "~/Notes/../.xindoze/keys",
        "~/.xindoze/../.xindoze/charter.toml",
        ".xindoze/engram.db",
    ] {
        deny(call(&w, &everything, &fs_read(), path(p)), "protected");
        deny(call(&w, &everything, &fs_write(), path(p)), "protected");
    }
    allow(call(
        &w,
        &everything,
        &fs_read(),
        path("~/.xindoze-other/x"),
    ));
    allow(call(&w, &everything, &fs_read(), path("~/.xindozes")));
}

#[test]
fn state_changes_on_a_parent_of_the_data_dir_are_denied() {
    let w = warden();
    let g = any("*");
    // Listing a parent is fine; moving, copying or deleting it is not.
    allow(call(&w, &g, &fs_list(), path("~")));
    deny(
        call(&w, &g, &fs_trash(), path("~")),
        "contains the Xindoze data directory",
    );
    deny(call(&w, &g, &fs_trash(), path("~/..")), "contains");
    deny(
        call(&w, &g, &fs_move(), json!({"from": "~", "to": "~/Backup"})),
        "contains",
    );
    // Moving into home must name the full destination.
    deny(
        call(&w, &g, &fs_move(), json!({"from": "~/a.txt", "to": "~"})),
        "name a more specific path",
    );
    allow(call(
        &w,
        &g,
        &fs_move(),
        json!({"from": "~/Downloads/a.txt", "to": "~/a.txt"}),
    ));
    // Third-party tools count as commit, so they reach parents too.
    let s = spec("mcp.zip", Risk::Observe, &["dir"], false);
    deny(call(&w, &g, &s, json!({"dir": "~"})), "contains");
}

#[cfg(unix)]
#[test]
fn data_dir_outside_home() {
    let w = Warden::new(Charter::default(), home(), PathBuf::from("/var/lib/xz")).unwrap();
    let g = vec![grant("*", &[])];
    deny(
        call(&w, &g, &fs_read(), path("/var/lib/xz/engram.db")),
        "protected",
    );
    deny(call(&w, &g, &fs_trash(), path("/var")), "contains");
    deny(call(&w, &g, &fs_trash(), path("/")), "contains");
    allow(call(&w, &g, &fs_read(), path("/var/log/syslog")));
    allow(call(&w, &g, &fs_trash(), path("~")));
    // A relative data dir is taken relative to home.
    let w = Warden::new(Charter::default(), home(), PathBuf::from("state/../data")).unwrap();
    deny(
        call(&w, &g, &fs_read(), path("~/data/engram.db")),
        "protected",
    );
    allow(call(&w, &g, &fs_read(), path("~/state/x")));
}

// ---- c. URLs and egress ----

#[test]
fn only_http_and_https_urls() {
    let w = warden();
    let g = any("net.fetch");
    for u in [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,hi",
        "ftp://h/x",
        "gopher://h/",
    ] {
        deny(call(&w, &g, &net_fetch(), url(u)), "scheme");
    }
    ask(
        call(&w, &g, &net_fetch(), url("HTTPS://Example.COM/")),
        "first contact with example.com",
    );
    ask(
        call(&w, &g, &net_fetch(), url("http://example.com/")),
        "first contact with example.com",
    );
}

#[test]
fn unknown_domains_ask_and_allowlisted_ones_pass() {
    let mut c = Charter::default();
    c.egress.allow_domains = vec!["*.wikipedia.org".into(), "Example.com".into()];
    let w = warden_with(c);
    let g = any("net.fetch");
    let fetch = |u: &str| call(&w, &g, &net_fetch(), url(u));
    allow(fetch("https://en.wikipedia.org/wiki/Rust"));
    allow(fetch("https://EN.WIKIPEDIA.ORG/wiki/Rust"));
    allow(fetch("https://en.wikipedia.org./wiki/Rust"));
    allow(fetch("https://en.wikipedia.org:8443/x"));
    allow(fetch("https://example.com/"));
    ask(
        fetch("https://wikipedia.org/"),
        "first contact with wikipedia.org",
    );
    ask(
        fetch("https://evilwikipedia.org/"),
        "first contact with evilwikipedia.org",
    );
    ask(
        fetch("https://en.wikipedia.org.evil.com/"),
        "first contact with en.wikipedia.org.evil.com",
    );
    ask(
        fetch("https://en.wikipedia.org@evil.com/"),
        "first contact with evil.com",
    );
    ask(
        fetch(r"https://evil.com\.wikipedia.org/"),
        "first contact with evil.com",
    );
    ask(fetch("https://wikipediа.org/"), "first contact with xn--");
    deny(fetch("https://evil.com%2f.wikipedia.org/"), "malformed");
}

#[test]
fn ip_literals() {
    let mut c = Charter::default();
    c.egress.allow_domains = vec!["*".into()];
    let w = warden_with(c);
    let g = any("net.fetch");
    let fetch = |u: &str| call(&w, &g, &net_fetch(), url(u));
    // Even an allow-everything domain list does not cover public IPs.
    allow(fetch("https://anything.example/"));
    ask(fetch("http://8.8.8.8/"), "first contact with 8.8.8.8");
    ask(
        fetch("http://[2001:4860:4860::8888]/"),
        "first contact with 2001:4860:4860::8888",
    );
    ask(fetch("http://[::ffff:8.8.8.8]/"), "first contact");
    allow(fetch("http://127.0.0.1:8080/"));
    allow(fetch("http://0x7f000001/"));
    allow(fetch("http://2130706433/"));
    allow(fetch("http://[::1]/"));
    allow(fetch("http://localhost/"));
    allow(fetch("http://192.168.1.20/"));
    allow(fetch("http://[fd12::1]/"));
}

#[test]
fn localhost_and_lan_switches() {
    let mut c = Charter::default();
    c.egress.allow_localhost = false;
    c.egress.allow_lan = false;
    let w = warden_with(c);
    let g = any("net.fetch");
    let fetch = |u: &str| call(&w, &g, &net_fetch(), url(u));
    for u in [
        "http://localhost:11434/",
        "http://127.0.0.1/",
        "http://[::1]/",
        "http://0.0.0.0/",
        "http://0177.0.0.1/",
        "http://x.localhost/",
    ] {
        deny(fetch(u), "disallows localhost");
    }
    for u in [
        "http://10.1.2.3/",
        "http://172.16.0.1/",
        "http://172.31.0.1/",
        "http://192.168.0.1/",
        "http://169.254.169.254/latest/meta-data",
        "http://100.100.1.1/",
        "http://[fe80::1]/",
        "http://[fd00::1]/",
        "http://[::ffff:10.0.0.1]/",
    ] {
        deny(fetch(u), "disallows LAN");
    }
    ask(fetch("http://172.32.0.1/"), "first contact");
}

#[test]
fn url_grants() {
    let mut c = Charter::default();
    c.egress.allow_domains = vec!["*.wikipedia.org".into()];
    let w = warden_with(c);
    let g = vec![grant("net.fetch", &["https://*.wikipedia.org/**"])];
    let fetch = |u: &str| call(&w, &g, &net_fetch(), url(u));
    allow(fetch("https://en.wikipedia.org/wiki/X"));
    allow(fetch("https://en.wikipedia.org"));
    deny(fetch("http://en.wikipedia.org/wiki/X"), "not granted");
    deny(fetch("https://evil.com/en.wikipedia.org/"), "not granted");
    deny(fetch("https://en.wikipedia.org@evil.com/"), "not granted");
    deny(fetch("https://en.wikipedia.org:8443/x"), "not granted");
    // A path never satisfies a URL grant, and the reverse.
    deny(fetch("en.wikipedia.org/wiki/X"), "not granted");
    let pg = vec![grant("fs.read", &["~/**"])];
    deny(
        call(&w, &pg, &fs_read(), path("https://en.wikipedia.org/x")),
        "not granted",
    );
}

#[test]
fn url_shaped_values_in_path_tools() {
    let mut c = Charter::default();
    c.egress.allow_domains = vec!["h.org".into()];
    let w = warden_with(c.clone());
    let g = any("fs.*");
    // Dot segments would let the path reading escape.
    deny(
        call(
            &w,
            &g,
            &fs_write(),
            path("https://h.org/../../.xindoze/charter.toml"),
        ),
        "segments",
    );
    allow(call(&w, &g, &fs_write(), path("https://h.org/x")));
    ask(
        call(&w, &g, &fs_write(), path("https://other.org/x")),
        "first contact",
    );
    // A deny rule on paths also covers the path reading of a URL-shaped value.
    c.rules = vec![rule("r1", "fs.write", Some("~/**"), Policy::Deny)];
    let w = warden_with(c);
    deny(
        call(&w, &g, &fs_write(), path("https://h.org/x")),
        "Charter rule r1",
    );
}

// ---- d. rules ----

#[test]
fn rule_precedence_is_deny_ask_allow() {
    let rules = [
        rule("a", "fs.*", None, Policy::Allow),
        rule("b", "fs.write", None, Policy::Ask),
        rule("c", "fs.write", Some("~/Secret/**"), Policy::Deny),
    ];
    for order in [[0, 1, 2], [2, 1, 0], [1, 2, 0]] {
        let w = warden_with(charter_with(
            order.iter().map(|&i| rules[i].clone()).collect(),
        ));
        let g = any("fs.*");
        deny(
            call(&w, &g, &fs_write(), path("~/Secret/x")),
            "Charter rule c",
        );
        ask(call(&w, &g, &fs_write(), path("~/a")), "Charter rule b");
        allow(call(&w, &g, &fs_read(), path("~/a")));
    }
}

#[test]
fn first_rule_wins_ties() {
    let w = warden_with(charter_with(vec![
        rule("first", "net.*", None, Policy::Deny),
        rule("second", "*", None, Policy::Deny),
    ]));
    deny(
        call(&w, &any("*"), &net_fetch(), url("https://x.org/")),
        "Charter rule first: Never let any organism use any tool matching net.*.",
    );
}

#[test]
fn allow_rule_lifts_a_default() {
    let mut c = charter_with(vec![rule(
        "r1",
        "net.post",
        Some("https://api.me.org/**"),
        Policy::Allow,
    )]);
    c.egress.allow_domains = vec!["api.me.org".into()];
    let w = warden_with(c);
    let g = any("net.post");
    allow(call(&w, &g, &net_post(), url("https://api.me.org/v1/x")));
    ask(
        call(&w, &g, &net_post(), url("https://api.me.org.evil.com/v1/x")),
        "first contact",
    );
    // Tainted commit calls still ask, whatever the rule says.
    let d = call_as(
        &w,
        ORG,
        &g,
        &net_post(),
        url("https://api.me.org/v1/x"),
        &web("web:evil.com"),
    );
    ask(d, "tainted input from web:evil.com");
}

#[test]
fn allow_rules_must_cover_every_resource() {
    let mut c = charter_with(vec![
        rule("r1", "fs.move", Some("~/Inbox/**"), Policy::Allow),
        rule("r2", "proc.kill", Some("~/x"), Policy::Allow),
    ]);
    c.defaults.act = Policy::Ask;
    let w = warden_with(c);
    let g = any("*");
    allow(call(
        &w,
        &g,
        &fs_move(),
        json!({"from": "~/Inbox/a", "to": "~/Inbox/b"}),
    ));
    ask(
        call(
            &w,
            &g,
            &fs_move(),
            json!({"from": "~/Inbox/a", "to": "~/Secret/b"}),
        ),
        "act action",
    );
    ask(
        call(
            &w,
            &g,
            &fs_move(),
            json!({"from": "~/Secret/a", "to": "~/Inbox/b"}),
        ),
        "act action",
    );
    // A resource-scoped rule says nothing about a tool without resources.
    ask(
        call(
            &w,
            &g,
            &tool("proc.kill", Risk::Commit, &[]),
            json!({"pid": 1}),
        ),
        "commit action",
    );
}

#[test]
fn deny_rules_match_any_resource_and_any_case() {
    let mut deny_tool = rule("t", "FS.WRITE", None, Policy::Deny);
    deny_tool.subject = "XINDOZE.*".into();
    let w = warden_with(charter_with(vec![
        rule("s", "fs.*", Some("~/Secret/**"), Policy::Deny),
        rule("k", "proc.kill", Some("~/x"), Policy::Deny),
        deny_tool,
    ]));
    let g = any("*");
    deny(
        call(
            &w,
            &g,
            &fs_move(),
            json!({"from": "~/Public/a", "to": "~/Secret/a"}),
        ),
        "Charter rule s",
    );
    deny(
        call(&w, &g, &fs_read(), path("~/SECRET/x")),
        "Charter rule s",
    );
    deny(
        call(&w, &g, &fs_read(), path("~/secret/x")),
        "Charter rule s",
    );
    deny(call(&w, &g, &fs_read(), path("~/Secret")), "Charter rule s");
    deny(call(&w, &g, &fs_write(), path("~/a")), "Charter rule t");
    allow(call(&w, &g, &fs_read(), path("~/Secrets/x")));
    // Resource-scoped deny rules ignore tools without resources.
    ask(
        call(&w, &g, &tool("proc.kill", Risk::Commit, &[]), json!({})),
        "commit action",
    );
}

#[test]
fn allow_rules_match_exact_case_only() {
    let mut c = charter_with(vec![rule("r1", "NET.POST", None, Policy::Allow)]);
    c.egress.allow_domains = vec!["x.org".into()];
    let w = warden_with(c);
    ask(
        call(&w, &any("*"), &net_post(), url("https://x.org/")),
        "commit action",
    );
}

#[test]
fn permissive_paths_follow_the_platform_case_rule() {
    // Grants fold case only where the filesystem does (Windows, Android,
    // macOS); elsewhere `~/notes` is a different folder from `~/Notes`.
    let w = warden();
    let g = vec![grant("fs.read", &["~/Notes/**"])];
    for p in ["~/notes/a.md", "~/NOTES/a.md"] {
        let d = call(&w, &g, &fs_read(), path(p));
        if crate::glob::FOLDS_CASE {
            allow(d);
        } else {
            deny(d, "not granted");
        }
    }
}

#[test]
fn deny_rules_reach_parents_of_what_they_protect() {
    let w = warden_with(charter_with(vec![
        rule("s", "fs.*", Some("~/Secret/**"), Policy::Deny),
        rule("k", "*", Some("~/.ssh/id_rsa"), Policy::Deny),
    ]));
    let g = any("*");
    deny(
        call(&w, &g, &fs_trash(), path("~/Secret")),
        "Charter rule s",
    );
    deny(
        call(&w, &g, &fs_trash(), path("~/SECRET")),
        "Charter rule s",
    );
    allow(call(
        &w,
        &g,
        &fs_move(),
        json!({"from": "~/Public", "to": "~/P2"}),
    ));
    allow(call(
        &w,
        &g,
        &fs_move(),
        json!({"from": "~/Public/a", "to": "~/P2/a"}),
    ));
    deny(call(&w, &g, &fs_trash(), path("~/.ssh")), "Charter rule k");
    deny(
        call(&w, &g, &fs_read(), path("~/.ssh/id_rsa")),
        "Charter rule k",
    );
    allow(call(&w, &g, &fs_read(), path("~/.ssh/config")));
    allow(call(&w, &g, &fs_trash(), path("~/Secret/../Public/x")));
    // Observing a parent is fine: listing home does not reveal secrets.
    allow(call(&w, &g, &fs_list(), path("~/.ssh")));
}

#[test]
fn ask_rules_reach_parents_too() {
    let w = warden_with(charter_with(vec![rule(
        "p",
        "fs.*",
        Some("~/Photos/**"),
        Policy::Ask,
    )]));
    let g = any("fs.*");
    // Home contains the data dir, so use a sibling parent instead.
    let w2 = Warden::new(
        w.charter(),
        home(),
        PathBuf::from(if cfg!(windows) { r"D:\xz" } else { "/var/xz" }),
    )
    .unwrap();
    ask(call(&w2, &g, &fs_trash(), path("~")), "Charter rule p");
    allow(call(&w2, &g, &fs_list(), path("~")));
    ask(
        call(&w, &g, &fs_read(), path("~/Photos/a.jpg")),
        "Charter rule p",
    );
}

#[test]
fn url_deny_rules_see_through_spelling() {
    let w = warden_with(charter_with(vec![rule(
        "e",
        "net.*",
        Some("https://evil.com/**"),
        Policy::Deny,
    )]));
    let g = any("net.*");
    let fetch = |u: &str| call(&w, &g, &net_fetch(), url(u));
    for u in [
        "https://evil.com/x",
        "https://EVIL.com/x",
        "HTTPS://evil.com./x",
        "https://evil.com/%78",
        "https://good.org@evil.com/x",
        "https://evil.com",
        "https://evil.com:443/x",
    ] {
        deny(fetch(u), "Charter rule e");
    }
    ask(fetch("http://evil.com/x"), "first contact");
    ask(fetch("https://evil.com.org/x"), "first contact");
}

#[test]
fn rule_subjects() {
    let mut r = rule("f", "*", None, Policy::Deny);
    r.subject = "xindoze.forge".into();
    let w = warden_with(charter_with(vec![r]));
    let g = any("*");
    let s = tool("sys.info", Risk::Observe, &[]);
    deny(
        call_as(&w, "xindoze.forge", &g, &s, json!({}), &Taint::none()),
        "Charter rule f",
    );
    deny(
        call_as(&w, "XINDOZE.FORGE", &g, &s, json!({}), &Taint::none()),
        "Charter rule f",
    );
    allow(call_as(
        &w,
        "xindoze.forger",
        &g,
        &s,
        json!({}),
        &Taint::none(),
    ));
    allow(call(&w, &g, &s, json!({})));
}

#[test]
fn rules_conditioned_on_taint() {
    let mut no_web = rule("t", "fs.write", None, Policy::Deny);
    no_web.when = Some(When {
        tainted: Some(true),
    });
    let mut clean_ok = rule("c", "net.post", None, Policy::Allow);
    clean_ok.when = Some(When {
        tainted: Some(false),
    });
    let mut always = rule("w", "sys.info", None, Policy::Ask);
    always.when = Some(When { tainted: None });
    let mut c = charter_with(vec![no_web, clean_ok, always]);
    c.egress.allow_domains = vec!["x.org".into()];
    let w = warden_with(c);
    let g = any("*");
    let t = web("web:x.org");
    allow(call(&w, &g, &fs_write(), path("~/a")));
    deny(
        call_as(&w, ORG, &g, &fs_write(), path("~/a"), &t),
        "Charter rule t",
    );
    allow(call(&w, &g, &net_post(), url("https://x.org/")));
    let d = call_as(&w, ORG, &g, &net_post(), url("https://x.org/"), &t);
    ask(d.clone(), "commit action");
    ask(d, "tainted input from web:x.org");
    ask(
        call(&w, &g, &tool("sys.info", Risk::Observe, &[]), json!({})),
        "Charter rule w",
    );
}

// ---- e/f. defaults and taint ----

#[test]
fn taint_override_for_every_default() {
    let policies = [Policy::Allow, Policy::Ask, Policy::Deny];
    for risk in [Risk::Observe, Risk::Act, Risk::Commit] {
        for default in policies {
            for tainted in [false, true] {
                let mut c = Charter::default();
                c.defaults.observe = default;
                c.defaults.act = default;
                c.defaults.commit = default;
                let w = warden_with(c);
                let s = tool("x.y", risk, &[]);
                let taint = if tainted {
                    web("web:a.com")
                } else {
                    Taint::none()
                };
                let d = call_as(&w, ORG, &any("x.y"), &s, json!({}), &taint);
                let floor = risk == Risk::Commit && tainted;
                let expect = if floor {
                    default.max(Policy::Ask)
                } else {
                    default
                };
                match (expect, d) {
                    (Policy::Allow, Decision::Allow) => {}
                    (Policy::Ask, Decision::Ask { reason }) => {
                        assert_eq!(
                            reason.contains("tainted input from web:a.com"),
                            floor,
                            "{reason}"
                        );
                        if default == Policy::Ask {
                            assert!(reason.contains("asks about by default"), "{reason}");
                        }
                    }
                    (Policy::Deny, Decision::Deny { reason }) => {
                        assert!(reason.contains("denies by default"), "{reason}");
                    }
                    (e, d) => panic!(
                        "{risk:?} default {default:?} tainted {tainted}: expected {e:?}, got {d:?}"
                    ),
                }
            }
        }
    }
}

#[test]
fn taint_reason_lists_every_source() {
    let w = warden();
    let mut t = web("web:a.com");
    t.merge(&Taint::from_source("msg:sms"));
    let d = call_as(
        &w,
        ORG,
        &any("*"),
        &tool("x.send", Risk::Commit, &[]),
        json!({}),
        &t,
    );
    ask(d, "tainted input from msg:sms, web:a.com");
}

#[test]
fn third_party_tools_count_as_commit() {
    let s = spec("mail.send", Risk::Observe, &[], false);
    let w = warden();
    ask(
        call(&w, &any("mail.*"), &s, json!({})),
        "mail.send is a third-party tool, treated as commit",
    );

    let mut c = Charter::default();
    c.defaults.commit = Policy::Allow;
    let w = warden_with(c);
    allow(call(&w, &any("mail.*"), &s, json!({})));
    ask(
        call_as(&w, ORG, &any("mail.*"), &s, json!({}), &web("msg:sms")),
        "tainted input from msg:sms",
    );

    let mut c = Charter::default();
    c.defaults.commit = Policy::Deny;
    let w = warden_with(c);
    deny(call(&w, &any("mail.*"), &s, json!({})), "third-party tool");
    deny(
        call_as(&w, ORG, &any("mail.*"), &s, json!({}), &web("msg:sms")),
        "denies by default",
    );
}

#[test]
fn default_reasons_name_the_risk() {
    let mut c = Charter::default();
    c.defaults.observe = Policy::Ask;
    c.defaults.act = Policy::Deny;
    let w = warden_with(c);
    let g = any("*");
    ask(
        call(&w, &g, &tool("a.b", Risk::Observe, &[]), json!({})),
        "a.b is an observe action",
    );
    deny(
        call(&w, &g, &tool("a.c", Risk::Act, &[]), json!({})),
        "a.c is an act action",
    );
    ask(
        call(&w, &g, &tool("a.d", Risk::Commit, &[]), json!({})),
        "a.d is a commit action",
    );
}

#[test]
fn some_tools_always_ask() {
    let mut c = charter_with(vec![rule("all", "*", None, Policy::Allow)]);
    c.defaults.commit = Policy::Allow;
    let w = warden_with(c);
    for name in ["xz.charter_add_rule", "engram.forget"] {
        let s = tool(name, Risk::Commit, &[]);
        ask(
            call(&w, &any("*"), &s, json!({})),
            "always needs your confirmation",
        );
    }
    let w = warden_with(charter_with(vec![rule("no", "xz.*", None, Policy::Deny)]));
    let s = tool("xz.charter_add_rule", Risk::Commit, &[]);
    deny(call(&w, &any("*"), &s, json!({})), "Charter rule no");
}

#[test]
fn ask_reasons_accumulate() {
    let w = warden();
    let d = call_as(
        &w,
        ORG,
        &any("net.post"),
        &net_post(),
        url("https://x.org/"),
        &web("web:y.org"),
    );
    ask(d.clone(), "first contact with x.org");
    ask(d.clone(), "net.post is a commit action");
    ask(d, "tainted input from web:y.org");
}

// ---- g. budget ----

fn budget(limit: u32) -> Warden {
    let mut c = Charter::default();
    c.budgets.tool_calls_per_minute = limit;
    warden_with(c)
}

fn info_at(w: &Warden, organism: &str, now: Instant) -> Decision {
    let s = tool("sys.info", Risk::Observe, &[]);
    let args = json!({});
    w.decide_at(
        &Request {
            organism,
            grants: &any("sys.*"),
            spec: &s,
            args: &args,
            taint: &Taint::none(),
        },
        now,
    )
}

#[test]
fn budget_is_a_sliding_window() {
    let w = budget(3);
    let t0 = Instant::now();
    let at = |ms: u64| t0 + Duration::from_millis(ms);
    allow(info_at(&w, ORG, at(0)));
    allow(info_at(&w, ORG, at(1_000)));
    allow(info_at(&w, ORG, at(2_000)));
    deny(info_at(&w, ORG, at(3_000)), "budget");
    deny(
        info_at(&w, ORG, at(59_999)),
        "at most 3 tool calls per minute",
    );
    // The first call leaves the window after exactly 60 s.
    allow(info_at(&w, ORG, at(60_000)));
    deny(info_at(&w, ORG, at(60_500)), "budget");
    allow(info_at(&w, ORG, at(61_000)));
    // Other Organisms have their own window.
    allow(info_at(&w, "xindoze.forge", at(61_000)));
}

#[test]
fn denied_calls_do_not_spend_budget() {
    let w = budget(1);
    let t0 = Instant::now();
    let s = tool("sys.info", Risk::Observe, &[]);
    let args = json!({});
    let refused = Request {
        organism: ORG,
        grants: &[],
        spec: &s,
        args: &args,
        taint: &Taint::none(),
    };
    deny(w.decide_at(&refused, t0), "not granted");
    allow(info_at(&w, ORG, t0));
    // A budget denial does not extend the window either.
    deny(info_at(&w, ORG, t0 + Duration::from_secs(30)), "budget");
    allow(info_at(&w, ORG, t0 + Duration::from_secs(60)));
}

#[test]
fn asked_calls_spend_budget() {
    let w = budget(1);
    ask(
        call(&w, &any("net.post"), &net_post(), url("https://x.org/")),
        "commit",
    );
    deny(call(&w, &any("*"), &fs_read(), path("~/a")), "budget");
}

#[test]
fn zero_budget_admits_nothing() {
    let w = budget(0);
    deny(info_at(&w, ORG, Instant::now()), "at most 0 tool calls");
}

#[test]
fn concurrent_calls_respect_the_budget() {
    let w = Arc::new(budget(50));
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let w = Arc::clone(&w);
            std::thread::spawn(move || {
                (0..20)
                    .filter(|_| info_at(&w, ORG, Instant::now()) == Decision::Allow)
                    .count()
            })
        })
        .collect();
    let allowed: usize = handles.into_iter().map(|h| h.join().unwrap()).sum();
    assert_eq!(allowed, 50);
}

// ---- runtime charter changes ----

#[test]
fn set_charter_takes_effect_and_rejects_invalid_ones() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Warden>();

    let w = warden();
    let g = any("*");
    ask(
        call(&w, &g, &net_post(), url("http://localhost/")),
        "commit",
    );
    let mut c = Charter::default();
    c.defaults.commit = Policy::Allow;
    w.set_charter(c.clone()).unwrap();
    assert_eq!(w.charter(), c);
    allow(call(&w, &g, &net_post(), url("http://localhost/")));

    let mut bad = c.clone();
    bad.rules.push(rule("x", "", None, Policy::Deny));
    assert!(matches!(w.set_charter(bad), Err(XzError::InvalidArgs(_))));
    assert_eq!(w.charter(), c);
    let mut bad = c.clone();
    bad.egress.allow_domains.push("[".into());
    assert!(w.set_charter(bad).is_err());
    allow(call(&w, &g, &net_post(), url("http://localhost/")));
}

#[test]
fn new_rejects_bad_input() {
    let rel = Warden::new(
        Charter::default(),
        PathBuf::from("home/u"),
        PathBuf::from("/x"),
    );
    assert!(matches!(rel, Err(XzError::InvalidArgs(_))));
    let bad = charter_with(vec![rule("r", "x", Some("~/a/../../**"), Policy::Deny)]);
    assert!(Warden::new(bad, home(), home().join(".xindoze")).is_err());
}

#[test]
fn decisions_are_deterministic() {
    let w = warden_with(charter_with(vec![rule(
        "a",
        "fs.write",
        Some("~/Notes/**"),
        Policy::Ask,
    )]));
    let g = vec![grant("fs.*", &["~/**"])];
    let first = call(&w, &g, &fs_write(), path("~/Notes/x"));
    for _ in 0..20 {
        assert_eq!(call(&w, &g, &fs_write(), path("~/Notes/x")), first);
    }
}

// ---- Windows ----

#[cfg(windows)]
mod windows {
    use super::*;

    #[test]
    fn windows_paths() {
        let w = warden();
        let g = vec![grant("fs.read", &[r"~\Notes\**"])];
        let read = |p: &str| call(&w, &g, &fs_read(), path(p));
        allow(read(r"C:\Users\u\Notes\a.md"));
        allow(read(r"c:\USERS\u\notes\A.md"));
        allow(read("C:/Users/u/Notes/a.md"));
        allow(read(r"~\Notes\sub\a.md"));
        allow(read(r"Notes\a.md"));
        deny(read(r"~\Notes\..\..\x"), "not granted");
        deny(
            read(r"C:\Users\u\Notes\..\..\..\Windows\System32\config\SAM"),
            "not granted",
        );
        deny(read(r"D:\Users\u\Notes\a.md"), "not granted");
        deny(read(r"\\server\share\Notes\a.md"), "ambiguous");
        deny(read(r"\\?\C:\Users\u\Notes\a.md"), "ambiguous");
        deny(read(r"\\.\PhysicalDrive0"), "ambiguous");
        deny(read(r"C:\Users\u\Notes\a.md:secret"), "ambiguous");
        deny(read(r"C:\Users\u\Notes\a.md."), "ambiguous");
        deny(read(r"C:\Users\u\Notes\CON"), "ambiguous");
        deny(read(r"C:\Users\u\NOTES~1\a.md"), "ambiguous");
        deny(read(r"C:Notes\a.md"), "absolute");
    }

    #[test]
    fn windows_data_dir() {
        let w = warden();
        let g = any("*");
        deny(
            call(&w, &g, &fs_read(), path(r"C:\USERS\U\.XINDOZE\engram.db")),
            "protected",
        );
        deny(
            call(&w, &g, &fs_read(), path(r"~\.xindoze\charter.toml")),
            "protected",
        );
        deny(
            call(
                &w,
                &g,
                &fs_read(),
                path(r"C:\Users\u\.xindoze.\charter.toml"),
            ),
            "ambiguous",
        );
        deny(
            call(
                &w,
                &g,
                &fs_read(),
                path(r"C:\Users\u\XINDOZ~1\charter.toml"),
            ),
            "ambiguous",
        );
        deny(call(&w, &g, &fs_trash(), path(r"C:\Users")), "contains");
    }
}
