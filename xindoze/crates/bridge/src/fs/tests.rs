use super::FsOrgan;
use crate::content::tiny_pdf;
use crate::testutil::Sandbox;
use serde_json::{Value, json};
use std::time::{Duration, SystemTime};
use xz_types::{CallCtx, Effect, Organ, Risk, ToolOutput, XzError};

fn organ(s: &Sandbox) -> FsOrgan {
    FsOrgan::new(s.home.clone(), s.data.clone())
}

async fn call(s: &Sandbox, tool: &str, args: Value) -> Result<ToolOutput, XzError> {
    organ(s).call(&s.ctx(), tool, args).await
}

async fn ok(s: &Sandbox, tool: &str, args: Value) -> ToolOutput {
    call(s, tool, args).await.unwrap()
}

fn names(v: &Value, key: &str) -> Vec<String> {
    v[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn specs_match_the_catalog() {
    let s = Sandbox::new();
    let tools = organ(&s).tools();
    let expect = [
        ("fs.read", Risk::Observe, vec!["path"]),
        ("fs.list", Risk::Observe, vec!["path"]),
        ("fs.stat", Risk::Observe, vec!["path"]),
        ("fs.search", Risk::Observe, vec!["root"]),
        ("fs.write", Risk::Act, vec!["path"]),
        ("fs.mkdir", Risk::Act, vec!["path"]),
        ("fs.move", Risk::Act, vec!["from", "to"]),
        ("fs.copy", Risk::Act, vec!["from", "to"]),
        ("fs.trash", Risk::Act, vec!["path"]),
        ("fs.delete_permanent", Risk::Commit, vec!["path"]),
    ];
    assert_eq!(tools.len(), expect.len());
    for (spec, (name, risk, res)) in tools.iter().zip(expect) {
        assert_eq!(spec.name, name);
        assert_eq!(spec.risk, risk, "{name}");
        assert_eq!(spec.resource_args, res, "{name}");
        assert!(spec.first_party && !spec.tainted_output);
        let schema = &spec.input_schema;
        assert_eq!(schema["type"], "object");
        for req in schema["required"].as_array().unwrap() {
            assert!(schema["properties"].get(req.as_str().unwrap()).is_some());
        }
        for r in &spec.resource_args {
            assert!(schema["properties"].get(r).is_some(), "{name}: {r}");
        }
    }
}

#[tokio::test]
async fn unknown_tool_and_bad_args() {
    let s = Sandbox::new();
    assert!(matches!(
        call(&s, "fs.nope", json!({})).await,
        Err(XzError::UnknownTool(_))
    ));
    let e = call(&s, "fs.read", json!({"pth": "a"})).await.unwrap_err();
    assert!(matches!(e, XzError::InvalidArgs(_)));
    assert!(e.to_string().contains("pth"), "{e}");
    let e = call(&s, "fs.list", json!({"path": "~", "limit": 0}))
        .await
        .unwrap_err();
    assert!(e.to_string().contains("limit"), "{e}");
}

#[tokio::test]
async fn read_text_binary_and_pdf() {
    let s = Sandbox::new();
    s.put("Notes/a.md", "hello world");
    let out = ok(&s, "fs.read", json!({"path": "~/Notes/a.md"})).await;
    assert_eq!(out.content["text"], "hello world");
    assert_eq!(out.content["truncated"], false);
    assert!(out.effects.is_empty() && out.taint.is_clean());

    // Relative paths are relative to home.
    let out = ok(&s, "fs.read", json!({"path": "Notes/a.md", "max_bytes": 5})).await;
    assert_eq!(out.content["text"], "hello");
    assert_eq!(out.content["truncated"], true);

    s.put("bin.dat", [0u8, 1, 2, 3, 255]);
    let out = ok(&s, "fs.read", json!({"path": "~/bin.dat"})).await;
    assert_eq!(
        out.content,
        json!({"path": s.home.join("bin.dat"), "binary": true, "size": 5})
    );

    s.put("doc.pdf", tiny_pdf("Invoice for March"));
    let out = ok(&s, "fs.read", json!({"path": "~/doc.pdf"})).await;
    assert_eq!(out.content["kind"], "pdf");
    assert!(
        out.content["text"]
            .as_str()
            .unwrap()
            .contains("Invoice for March")
    );

    let e = call(&s, "fs.read", json!({"path": "~/Notes"}))
        .await
        .unwrap_err();
    assert!(e.to_string().contains("fs.list"), "{e}");
    assert!(matches!(
        call(&s, "fs.read", json!({"path": "~/missing.txt"})).await,
        Err(XzError::NotFound(_))
    ));
}

#[tokio::test]
async fn data_dir_is_off_limits() {
    let s = Sandbox::new();
    std::fs::write(s.data.join("charter.toml"), "x").unwrap();
    for (tool, args) in [
        (
            "fs.read",
            json!({"path": "~/.local/share/xindoze/charter.toml"}),
        ),
        (
            "fs.write",
            json!({"path": "~/.local/share/Xindoze/x", "content": ""}),
        ),
        ("fs.list", json!({"path": "~/.local/share/xindoze"})),
    ] {
        assert!(
            matches!(call(&s, tool, args).await, Err(XzError::Denied(_))),
            "{tool}"
        );
    }
    // Trashing or deleting an ancestor of the data directory is refused.
    for tool in ["fs.trash", "fs.delete_permanent"] {
        let e = call(&s, tool, json!({"path": "~/.local"}))
            .await
            .unwrap_err();
        assert!(e.to_string().contains("data directory"), "{tool}: {e}");
        let e = call(&s, tool, json!({"path": "~"})).await.unwrap_err();
        assert!(e.to_string().contains("home"), "{tool}: {e}");
    }
    let e = call(&s, "fs.move", json!({"from": "~/.local", "to": "~/x"}))
        .await
        .unwrap_err();
    assert!(e.to_string().contains("data directory"), "{e}");
}

#[tokio::test]
async fn list_sorted_recursive_and_limited() {
    let s = Sandbox::new();
    s.put("D/b.txt", "bb");
    s.put("D/a.txt", "a");
    s.put("D/sub/c.txt", "c");
    let out = ok(&s, "fs.list", json!({"path": "~/D"})).await;
    assert_eq!(names(&out.content, "entries"), ["a.txt", "b.txt", "sub"]);
    assert_eq!(out.content["entries"][0]["kind"], "file");
    assert_eq!(out.content["entries"][0]["size"], 1);
    assert!(
        out.content["entries"][0]["modified"]
            .as_str()
            .unwrap()
            .ends_with('Z')
    );
    assert_eq!(out.content["entries"][2]["kind"], "dir");

    let out = ok(&s, "fs.list", json!({"path": "~/D", "recursive": true})).await;
    assert_eq!(
        names(&out.content, "entries"),
        ["a.txt", "b.txt", "sub", "c.txt"]
    );
    assert_eq!(out.content["truncated"], false);

    let out = ok(
        &s,
        "fs.list",
        json!({"path": "~/D", "recursive": true, "limit": 2}),
    )
    .await;
    assert_eq!(names(&out.content, "entries"), ["a.txt", "b.txt"]);
    assert_eq!(out.content["truncated"], true);

    // A recursive listing of home never descends into the data directory.
    std::fs::write(s.data.join("engram.db"), "secret").unwrap();
    let out = ok(&s, "fs.list", json!({"path": "~", "recursive": true})).await;
    assert!(!names(&out.content, "entries").contains(&"engram.db".to_string()));

    let e = call(&s, "fs.list", json!({"path": "~/D/a.txt"}))
        .await
        .unwrap_err();
    assert!(matches!(e, XzError::InvalidArgs(_)));
}

#[tokio::test]
async fn stat_describes_without_following() {
    let s = Sandbox::new();
    s.put("f.txt", "abc");
    let out = ok(&s, "fs.stat", json!({"path": "~/f.txt"})).await;
    assert_eq!(out.content["exists"], true);
    assert_eq!(out.content["kind"], "file");
    assert_eq!(out.content["size"], 3);
    assert_eq!(out.content["readonly"], false);
    let out = ok(&s, "fs.stat", json!({"path": "~/nope"})).await;
    assert_eq!(out.content["exists"], false);
}

#[cfg(unix)]
#[tokio::test]
async fn symlinks_are_reported_or_refused() {
    use std::os::unix::fs::symlink;
    let s = Sandbox::new();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.txt"), "s").unwrap();
    std::fs::create_dir_all(s.home.join("D")).unwrap();
    symlink(outside.path(), s.home.join("D/link")).unwrap();
    symlink(
        outside.path().join("secret.txt"),
        s.home.join("D/file-link"),
    )
    .unwrap();

    // list and stat report links without following them.
    let out = ok(&s, "fs.list", json!({"path": "~/D", "recursive": true})).await;
    assert_eq!(names(&out.content, "entries"), ["file-link", "link"]);
    assert_eq!(out.content["entries"][1]["kind"], "symlink");
    assert_eq!(out.content["entries"][1]["target"], json!(outside.path()));
    let out = ok(&s, "fs.stat", json!({"path": "~/D/link"})).await;
    assert_eq!(out.content["kind"], "symlink");

    // Everything else refuses to go through a link, naming it.
    let calls = [
        ("fs.read", json!({"path": "~/D/link/secret.txt"})),
        ("fs.read", json!({"path": "~/D/file-link"})),
        ("fs.stat", json!({"path": "~/D/link/secret.txt"})),
        ("fs.list", json!({"path": "~/D/link"})),
        ("fs.search", json!({"root": "~/D/link"})),
        (
            "fs.write",
            json!({"path": "~/D/link/new.txt", "content": "x"}),
        ),
        ("fs.mkdir", json!({"path": "~/D/link/sub"})),
        ("fs.move", json!({"from": "~/D/file-link", "to": "~/x"})),
        ("fs.copy", json!({"from": "~/D/link", "to": "~/x"})),
        ("fs.trash", json!({"path": "~/D/link/secret.txt"})),
        (
            "fs.delete_permanent",
            json!({"path": "~/D/link/secret.txt"}),
        ),
    ];
    for (tool, args) in calls {
        let e = call(&s, tool, args).await.unwrap_err();
        assert!(matches!(e, XzError::InvalidArgs(_)), "{tool}: {e}");
        assert!(e.to_string().contains("symbolic link"), "{tool}: {e}");
    }
    assert!(outside.path().join("secret.txt").exists());

    // Copying a folder skips links inside it.
    let out = ok(&s, "fs.copy", json!({"from": "~/D", "to": "~/D2"})).await;
    assert_eq!(out.content["skipped_links"], 2);
}

#[tokio::test]
async fn search_filters_sorts_and_limits() {
    let s = Sandbox::new();
    let now = SystemTime::now();
    let set_mtime = |p: &std::path::Path, ago: u64| {
        let f = std::fs::File::options().write(true).open(p).unwrap();
        f.set_modified(now - Duration::from_secs(ago)).unwrap();
    };
    let a = s.put("Docs/alpha.txt", "The Quarterly report");
    let b = s.put("Docs/beta.md", "nothing here but a longer body of text");
    let c = s.put("Docs/sub/Gamma.TXT", "quarterly numbers");
    s.put("Docs/sub/inv.pdf", tiny_pdf("QUARTERLY invoice"));
    s.put("Docs/.hidden/quarterly.txt", "quarterly");
    s.put(".local/share/xindoze/quarterly.txt", "quarterly");
    std::fs::create_dir_all(s.home.join("Docs/Quarterly")).unwrap();
    set_mtime(&a, 300);
    set_mtime(&b, 100);
    set_mtime(&c, 200);

    let paths = |out: &ToolOutput| -> Vec<String> {
        out.content["matches"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["name"].as_str().unwrap().to_string())
            .collect()
    };

    let out = ok(
        &s,
        "fs.search",
        json!({"root": "~", "contains": "quarterly"}),
    )
    .await;
    assert_eq!(paths(&out), ["alpha.txt", "Gamma.TXT", "inv.pdf"]);
    assert_eq!(out.content["total_matches"], 3);

    let out = ok(
        &s,
        "fs.search",
        json!({"root": "~/Docs", "name_glob": "*.txt"}),
    )
    .await;
    assert_eq!(paths(&out), ["alpha.txt", "Gamma.TXT"]);

    // A pure name search also finds folders.
    let out = ok(
        &s,
        "fs.search",
        json!({"root": "~", "name_glob": "quarterly"}),
    )
    .await;
    assert_eq!(paths(&out), ["Quarterly"]);
    assert_eq!(out.content["matches"][0]["kind"], "dir");

    let out = ok(
        &s,
        "fs.search",
        json!({"root": "~/Docs", "sort": "size", "limit": 2}),
    )
    .await;
    assert_eq!(paths(&out)[0], "inv.pdf");
    assert_eq!(paths(&out).len(), 2);
    assert_eq!(out.content["truncated"], true);

    let out = ok(
        &s,
        "fs.search",
        json!({"root": "~/Docs", "name_glob": "*.*", "sort": "modified", "min_size": 1}),
    )
    .await;
    assert_eq!(
        paths(&out),
        ["inv.pdf", "beta.md", "Gamma.TXT", "alpha.txt"]
    );

    let out = ok(&s, "fs.search", json!({"root": "~/Docs", "sort": "name"})).await;
    assert_eq!(
        paths(&out),
        ["alpha.txt", "beta.md", "Gamma.TXT", "inv.pdf"]
    );

    let out = ok(&s, "fs.search", json!({"root": "~/Docs", "min_size": 30})).await;
    assert_eq!(paths(&out), ["beta.md", "inv.pdf"]);

    for bad in [
        json!({"root": "~", "sort": "date"}),
        json!({"root": "~", "name_glob": "a/*.txt"}),
        json!({"root": "~", "name_glob": "[a"}),
        json!({"root": "~/Docs/alpha.txt"}),
        json!({"root": "~", "limit": 5000}),
    ] {
        let e = call(&s, "fs.search", bad.clone()).await.unwrap_err();
        assert!(matches!(e, XzError::InvalidArgs(_)), "{bad}: {e}");
    }
}

#[tokio::test]
async fn write_reports_effects_and_snapshots() {
    let s = Sandbox::new();
    let out = ok(
        &s,
        "fs.write",
        json!({"path": "~/New/Deep/a.txt", "content": "one"}),
    )
    .await;
    let p = s.home.join("New/Deep/a.txt");
    assert_eq!(std::fs::read_to_string(&p).unwrap(), "one");
    assert_eq!(
        out.effects,
        vec![
            Effect::DirCreated {
                path: s.home.join("New")
            },
            Effect::FileCreated { path: p.clone() }
        ]
    );
    assert_eq!(out.content["created"], true);

    let out = ok(
        &s,
        "fs.write",
        json!({"path": "~/New/Deep/a.txt", "content": "two"}),
    )
    .await;
    assert_eq!(
        out.effects,
        vec![Effect::FileModified {
            path: p.clone(),
            pre: "blob0".into()
        }]
    );
    let out = ok(
        &s,
        "fs.write",
        json!({"path": "~/New/Deep/a.txt", "content": "+", "append": true}),
    )
    .await;
    assert_eq!(
        out.effects,
        vec![Effect::FileModified {
            path: p.clone(),
            pre: "blob1".into()
        }]
    );
    assert_eq!(std::fs::read_to_string(&p).unwrap(), "two+");
    let blobs = s.recorder.blobs.lock().unwrap().clone();
    assert_eq!(blobs[0], (p.clone(), b"one".to_vec()));
    assert_eq!(blobs[1], (p.clone(), b"two".to_vec()));

    // Without a snapshot store the change is reported as irreversible.
    let out = organ(&s)
        .call(
            &CallCtx::test(),
            "fs.write",
            json!({"path": "~/New/Deep/a.txt", "content": "3"}),
        )
        .await
        .unwrap();
    assert!(matches!(out.effects[..], [Effect::Irreversible { .. }]));

    let e = call(&s, "fs.write", json!({"path": "~/New", "content": "x"}))
        .await
        .unwrap_err();
    assert!(matches!(e, XzError::InvalidArgs(_)));
}

#[tokio::test]
async fn mkdir_reports_topmost_created() {
    let s = Sandbox::new();
    let out = ok(&s, "fs.mkdir", json!({"path": "~/A/B/C"})).await;
    assert!(s.home.join("A/B/C").is_dir());
    assert_eq!(
        out.effects,
        vec![Effect::DirCreated {
            path: s.home.join("A")
        }]
    );
    let out = ok(&s, "fs.mkdir", json!({"path": "~/A/B"})).await;
    assert_eq!(out.content["created"], false);
    assert!(out.effects.is_empty());
    s.put("file", "");
    assert!(
        call(&s, "fs.mkdir", json!({"path": "~/file"}))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn move_renames_moves_into_dirs_and_never_overwrites() {
    let s = Sandbox::new();
    let a = s.put("a.txt", "a");
    let out = ok(&s, "fs.move", json!({"from": "~/a.txt", "to": "~/b.txt"})).await;
    let b = s.home.join("b.txt");
    assert!(!a.exists() && b.exists());
    assert_eq!(
        out.effects,
        vec![Effect::FileMoved {
            from: a.clone(),
            to: b.clone()
        }]
    );

    std::fs::create_dir(s.home.join("Box")).unwrap();
    let out = ok(&s, "fs.move", json!({"from": "~/b.txt", "to": "~/Box"})).await;
    let boxed = s.home.join("Box/b.txt");
    assert!(boxed.exists());
    assert_eq!(out.content["to"], json!(boxed));
    assert_eq!(
        out.effects,
        vec![Effect::FileMoved {
            from: b,
            to: boxed.clone()
        }]
    );

    s.put("c.txt", "c");
    s.put("Box/c.txt", "existing");
    let e = call(&s, "fs.move", json!({"from": "~/c.txt", "to": "~/Box"}))
        .await
        .unwrap_err();
    assert!(e.to_string().contains("never overwrites"), "{e}");
    let e = call(
        &s,
        "fs.move",
        json!({"from": "~/c.txt", "to": "~/Box/b.txt"}),
    )
    .await
    .unwrap_err();
    assert!(e.to_string().contains("never overwrites"), "{e}");
    assert_eq!(
        std::fs::read_to_string(s.home.join("Box/c.txt")).unwrap(),
        "existing"
    );

    let e = call(&s, "fs.move", json!({"from": "~/Box", "to": "~/Box/inner"}))
        .await
        .unwrap_err();
    assert!(e.to_string().contains("inside itself"), "{e}");

    // Missing parents of the destination are created and reported.
    let out = ok(
        &s,
        "fs.move",
        json!({"from": "~/c.txt", "to": "~/X/Y/c.txt"}),
    )
    .await;
    assert_eq!(
        out.effects[0],
        Effect::DirCreated {
            path: s.home.join("X")
        }
    );

    assert!(matches!(
        call(&s, "fs.move", json!({"from": "~/gone", "to": "~/x"})).await,
        Err(XzError::NotFound(_))
    ));
}

#[tokio::test]
async fn copy_files_and_trees_without_overwriting() {
    let s = Sandbox::new();
    s.put("src/a.txt", "a");
    s.put("src/sub/b.txt", "b");
    let out = ok(
        &s,
        "fs.copy",
        json!({"from": "~/src/a.txt", "to": "~/a2.txt"}),
    )
    .await;
    assert_eq!(std::fs::read_to_string(s.home.join("a2.txt")).unwrap(), "a");
    assert_eq!(
        out.effects,
        vec![Effect::FileCreated {
            path: s.home.join("a2.txt")
        }]
    );

    let out = ok(&s, "fs.copy", json!({"from": "~/src", "to": "~/dst"})).await;
    assert_eq!(
        std::fs::read_to_string(s.home.join("dst/sub/b.txt")).unwrap(),
        "b"
    );
    assert_eq!(
        out.effects,
        vec![Effect::FileCreated {
            path: s.home.join("dst")
        }]
    );
    assert_eq!(out.content["skipped_links"], 0);

    // Into an existing folder.
    ok(&s, "fs.copy", json!({"from": "~/a2.txt", "to": "~/dst"})).await;
    assert!(s.home.join("dst/a2.txt").exists());

    let e = call(
        &s,
        "fs.copy",
        json!({"from": "~/src/a.txt", "to": "~/a2.txt"}),
    )
    .await
    .unwrap_err();
    assert!(e.to_string().contains("never overwrites"), "{e}");
    let e = call(
        &s,
        "fs.copy",
        json!({"from": "~/src", "to": "~/src/sub/deeper"}),
    )
    .await
    .unwrap_err();
    assert!(e.to_string().contains("inside itself"), "{e}");
}

#[tokio::test]
async fn trash_uses_task_layout() {
    let s = Sandbox::new();
    let a = s.put("a.txt", "1");
    let out = ok(&s, "fs.trash", json!({"path": "~/a.txt"})).await;
    let slot0 = s.data.join("trash/task-1/0-a.txt");
    assert!(!a.exists());
    assert_eq!(std::fs::read_to_string(&slot0).unwrap(), "1");
    assert_eq!(
        out.effects,
        vec![Effect::FileTrashed {
            path: a.clone(),
            trashed_to: slot0
        }]
    );

    s.put("a.txt", "2");
    let out = ok(&s, "fs.trash", json!({"path": "~/a.txt"})).await;
    let slot1 = s.data.join("trash/task-1/1-a.txt");
    assert_eq!(std::fs::read_to_string(&slot1).unwrap(), "2");
    assert_eq!(out.content["trashed_to"], json!(slot1));

    s.put("Dir/x", "x");
    ok(&s, "fs.trash", json!({"path": "~/Dir"})).await;
    assert!(s.data.join("trash/task-1/2-Dir/x").exists());

    // Hostile task ids stay one folder below the trash.
    let mut ctx = s.ctx();
    ctx.task_id = "../../escape".into();
    s.put("b.txt", "b");
    let out = organ(&s)
        .call(&ctx, "fs.trash", json!({"path": "~/b.txt"}))
        .await
        .unwrap();
    let to = out.content["trashed_to"].as_str().unwrap().to_string();
    assert!(
        std::path::Path::new(&to).starts_with(s.data.join("trash")),
        "{to}"
    );
    assert!(matches!(
        call(&s, "fs.trash", json!({"path": "~/gone"})).await,
        Err(XzError::NotFound(_))
    ));
}

#[tokio::test]
async fn delete_permanent_is_irreversible() {
    let s = Sandbox::new();
    s.put("D/x.txt", "x");
    let out = ok(&s, "fs.delete_permanent", json!({"path": "~/D"})).await;
    assert!(!s.home.join("D").exists());
    assert!(matches!(out.effects[..], [Effect::Irreversible { .. }]));
    s.put("f", "");
    ok(&s, "fs.delete_permanent", json!({"path": "~/f"})).await;
    assert!(!s.home.join("f").exists());
}
