//! Rewind: undoing journaled effects (SPEC §3.5).
//!
//! Events are undone newest first (reverse seq), and each event's effects
//! in reverse order, so chains like create → modify → move unwind cleanly.
//! One effect failing never stops the others. Anything Rewind overwrites
//! or deletes is first copied into a blob, so a rewind loses nothing.

use crate::Engram;
use crate::journal::EVENT_COLS;
use rusqlite::types::Value as SqlValue;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File};
use std::io;
use std::path::Path;
use std::sync::PoisonError;
use xz_types::{Effect, Result, XzError};

/// Which events to rewind. Only events recorded on this device are
/// considered: a synced event's paths belong to another device's disk.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RewindSelector {
    /// Every event of one task ("undo that").
    Task(String),
    /// Every event at or after this time ("undo the last ten minutes").
    Since(i64),
    /// One Organism's events at or after a time ("undo what Forge did today").
    Organism { name: String, since_ms: i64 },
    /// A single event, by local seq.
    Seq(i64),
}

/// What a rewind did, effect by effect.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RewindReport {
    /// Local seqs of the events now marked rewound, newest first. An event
    /// with a failed effect stays unmarked, so a later rewind retries it.
    pub events: Vec<i64>,
    pub undone: Vec<RewindItem>,
    pub skipped: Vec<RewindItem>,
    pub failed: Vec<RewindItem>,
}

/// One effect's outcome in a [`RewindReport`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RewindItem {
    pub seq: i64,
    pub tool: String,
    pub effect: Effect,
    /// Why the effect was skipped or failed; empty when undone.
    pub reason: String,
    /// Blob holding the content Rewind replaced or removed: a file's bytes,
    /// or a KV value as JSON. Kept for the blob retention window.
    pub backup: Option<String>,
}

enum Undo {
    Done(Option<String>),
    Skipped(String),
}

impl Engram {
    /// Undoes the effects of every non-rewound local event matching `sel`.
    /// Running the same rewind again does nothing.
    pub fn rewind(&self, sel: &RewindSelector) -> Result<RewindReport> {
        // Two concurrent rewinds of overlapping events would undo them twice.
        let _one_at_a_time = self
            .rewind_lock
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let mut report = RewindReport::default();
        for ev in self.rewindable(sel)? {
            let mut clean = true;
            for effect in ev.effects.iter().rev() {
                let item = |reason: String, backup| RewindItem {
                    seq: ev.seq,
                    tool: ev.tool.clone(),
                    effect: effect.clone(),
                    reason,
                    backup,
                };
                match self.undo(effect) {
                    Ok(Undo::Done(backup)) => report.undone.push(item(String::new(), backup)),
                    Ok(Undo::Skipped(why)) => report.skipped.push(item(why, None)),
                    Err(e) => {
                        clean = false;
                        report.failed.push(item(e.to_string(), None));
                    }
                }
            }
            if clean && self.mark_rewound(ev.seq)? {
                report.events.push(ev.seq);
            }
        }
        Ok(report)
    }

    /// Local, non-rewound events matching `sel` that changed something,
    /// newest seq first. Reads and refused calls are never marked rewound.
    fn rewindable(&self, sel: &RewindSelector) -> Result<Vec<xz_types::JournalEvent>> {
        let (clause, arg): (&str, Vec<SqlValue>) = match sel {
            RewindSelector::Task(id) => ("task_id = ?2", vec![SqlValue::Text(id.clone())]),
            RewindSelector::Since(ms) => ("ts_ms >= ?2", vec![SqlValue::Integer(*ms)]),
            RewindSelector::Organism { name, since_ms } => (
                "organism = ?2 AND ts_ms >= ?3",
                vec![SqlValue::Text(name.clone()), SqlValue::Integer(*since_ms)],
            ),
            RewindSelector::Seq(seq) => ("seq = ?2", vec![SqlValue::Integer(*seq)]),
        };
        let sql = format!(
            "SELECT {EVENT_COLS} FROM events \
             WHERE device = ?1 AND rewound = 0 AND effects != '[]' AND {clause} \
             ORDER BY seq DESC"
        );
        let mut args = vec![SqlValue::Text(self.device_id.clone())];
        args.extend(arg);
        self.query_events(&sql, rusqlite::params_from_iter(args), false)
    }

    fn undo(&self, effect: &Effect) -> Result<Undo> {
        match effect {
            Effect::FileCreated { path } => self.remove_created(absolute(path)?),
            Effect::FileModified { path, pre } => self.restore(absolute(path)?, pre),
            Effect::FileMoved { from, to } => move_back(absolute(to)?, absolute(from)?),
            Effect::FileTrashed { path, trashed_to } => {
                move_back(absolute(trashed_to)?, absolute(path)?)
            }
            Effect::DirCreated { path } => remove_empty_dir(absolute(path)?),
            Effect::KvSet { ns, key, pre } => self.restore_kv(ns, key, pre.as_ref()),
            Effect::Irreversible { note } => Ok(Undo::Skipped(format!("irreversible: {note}"))),
        }
    }

    fn remove_created(&self, path: &Path) -> Result<Undo> {
        let Some(meta) = existing(path)? else {
            return Ok(Undo::Skipped("no longer exists".into()));
        };
        if meta.is_dir() {
            return Ok(Undo::Skipped("now a directory; left in place".into()));
        }
        // The file may have been edited since it was created. A symlink has
        // no content of its own to keep.
        let backup = if meta.is_file() {
            self.snapshot_file(path)?
        } else {
            None
        };
        fs::remove_file(path).map_err(io_ctx("remove", path))?;
        Ok(Undo::Done(backup))
    }

    fn restore(&self, path: &Path, pre: &str) -> Result<Undo> {
        let mut src = self
            .open_blob(pre)
            .map_err(|e| XzError::Other(format!("pre-image unavailable: {e}")))?;
        if existing(path)?.is_some_and(|m| m.is_dir()) {
            return Err(XzError::Other(format!(
                "{} is now a directory",
                path.display()
            )));
        }
        let backup = self.snapshot_file(path)?;
        if backup.as_deref() == Some(pre) {
            return Ok(Undo::Done(None));
        }
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(io_ctx("create", dir))?;
        }
        // Writing in place keeps the file's identity and permissions.
        let mut dst = File::create(path).map_err(io_ctx("write", path))?;
        io::copy(&mut src, &mut dst).map_err(io_ctx("write", path))?;
        Ok(Undo::Done(backup))
    }

    fn restore_kv(&self, ns: &str, key: &str, pre: Option<&Value>) -> Result<Undo> {
        let current = self.kv_get(ns, key)?;
        if current.as_ref() == pre {
            return Ok(Undo::Done(None));
        }
        let backup = match &current {
            Some(v) => Some(self.put_blob(&serde_json::to_vec(v)?)?),
            None => None,
        };
        match pre {
            Some(v) => self.kv_set(ns, key, v)?,
            None => self.kv_delete(ns, key)?,
        };
        Ok(Undo::Done(backup))
    }
}

/// Moves `src` back to `dst`, never overwriting whatever is at `dst` now.
fn move_back(src: &Path, dst: &Path) -> Result<Undo> {
    if existing(src)?.is_none() {
        return Ok(Undo::Skipped(format!("{} no longer exists", src.display())));
    }
    if existing(dst)?.is_some() {
        return Err(XzError::Other(format!(
            "refusing to overwrite {}, which exists again",
            dst.display()
        )));
    }
    if let Some(dir) = dst.parent() {
        fs::create_dir_all(dir).map_err(io_ctx("create", dir))?;
    }
    match fs::rename(src, dst) {
        Ok(()) => {}
        // Trash or a move target may sit on another volume.
        Err(e) if e.kind() == io::ErrorKind::CrossesDevices && src.is_file() => {
            fs::copy(src, dst).map_err(io_ctx("copy to", dst))?;
            fs::remove_file(src).map_err(io_ctx("remove", src))?;
        }
        Err(e) => return Err(io_ctx("move", src)(e)),
    }
    Ok(Undo::Done(None))
}

fn remove_empty_dir(path: &Path) -> Result<Undo> {
    match existing(path)? {
        None => return Ok(Undo::Skipped("no longer exists".into())),
        Some(m) if !m.is_dir() => return Ok(Undo::Skipped("no longer a directory".into())),
        Some(_) => {}
    }
    // An Organ records only the topmost folder it created (mkdir -p a/b/c),
    // so a tree holding nothing but empty folders is still ours to remove.
    if !only_empty_dirs(path)? {
        return Ok(Undo::Skipped("not empty; left in place".into()));
    }
    remove_empty_tree(path)?;
    Ok(Undo::Done(None))
}

/// True if `dir` contains nothing but (recursively) empty folders.
/// Symlinks count as content, so they are never followed or removed.
fn only_empty_dirs(dir: &Path) -> Result<bool> {
    for entry in fs::read_dir(dir).map_err(io_ctx("read", dir))? {
        let entry = entry.map_err(io_ctx("read", dir))?;
        let kind = entry.file_type().map_err(io_ctx("stat", &entry.path()))?;
        if !kind.is_dir() || !only_empty_dirs(&entry.path())? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn remove_empty_tree(dir: &Path) -> Result<()> {
    for entry in fs::read_dir(dir).map_err(io_ctx("read", dir))? {
        let entry = entry.map_err(io_ctx("read", dir))?;
        remove_empty_tree(&entry.path())?;
    }
    fs::remove_dir(dir).map_err(io_ctx("remove", dir))
}

/// Effect paths are written resolved by the Organs. A relative one would
/// resolve against the daemon's working directory, so it is refused.
fn absolute(p: &Path) -> Result<&Path> {
    if p.is_absolute() {
        Ok(p)
    } else {
        Err(XzError::InvalidArgs(format!(
            "effect path is not absolute: {}",
            p.display()
        )))
    }
}

/// Metadata of `path` without following a final symlink, or None if absent.
fn existing(path: &Path) -> Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(m) => Ok(Some(m)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_ctx("inspect", path)(e)),
    }
}

fn io_ctx(what: &'static str, path: &Path) -> impl FnOnce(io::Error) -> XzError {
    move |e| XzError::Other(format!("cannot {what} {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::BlobSnapshotter;
    use crate::testutil::event;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::Arc;
    use xz_types::Snapshotter;

    /// An Engram plus a scratch "home" with real files.
    struct World {
        e: Arc<Engram>,
        home: tempfile::TempDir,
    }

    impl World {
        fn new() -> Self {
            Self {
                e: Arc::new(Engram::open_temp().unwrap()),
                home: tempfile::tempdir().unwrap(),
            }
        }

        fn path(&self, rel: &str) -> PathBuf {
            self.home.path().join(rel)
        }

        fn journal(&self, task: &str, tool: &str, effects: Vec<Effect>) -> i64 {
            self.e.append(&event(task, tool, effects)).unwrap()
        }

        /// What fs.write does: snapshot, write, report the effect.
        fn write(&self, task: &str, rel: &str, content: &str) -> i64 {
            let path = self.path(rel);
            let effect = match BlobSnapshotter(self.e.clone()).snapshot(&path).unwrap() {
                Some(pre) => Effect::FileModified {
                    path: path.clone(),
                    pre,
                },
                None => Effect::FileCreated { path: path.clone() },
            };
            fs::write(&path, content).unwrap();
            self.journal(task, "fs.write", vec![effect])
        }

        fn mv(&self, task: &str, from: &str, to: &str) -> i64 {
            let (from, to) = (self.path(from), self.path(to));
            fs::rename(&from, &to).unwrap();
            self.journal(task, "fs.move", vec![Effect::FileMoved { from, to }])
        }

        fn read(&self, rel: &str) -> Option<String> {
            fs::read_to_string(self.path(rel)).ok()
        }

        fn rewind_task(&self, task: &str) -> RewindReport {
            self.e.rewind(&RewindSelector::Task(task.into())).unwrap()
        }
    }

    fn reasons(items: &[RewindItem]) -> Vec<&str> {
        items.iter().map(|i| i.reason.as_str()).collect()
    }

    #[test]
    fn file_created_is_removed_with_a_backup() {
        let w = World::new();
        w.write("t", "new.txt", "fresh");
        let r = w.rewind_task("t");
        assert_eq!(w.read("new.txt"), None);
        assert_eq!(r.undone.len(), 1);
        let backup = r.undone[0].backup.as_deref().unwrap();
        assert_eq!(w.e.get_blob(backup).unwrap(), b"fresh");
    }

    #[test]
    fn file_modified_is_restored_and_the_overwrite_kept() {
        let w = World::new();
        fs::write(w.path("a.txt"), "original").unwrap();
        w.write("t", "a.txt", "edited");
        let r = w.rewind_task("t");
        assert_eq!(w.read("a.txt").as_deref(), Some("original"));
        let backup = r.undone[0].backup.as_deref().unwrap();
        assert_eq!(w.e.get_blob(backup).unwrap(), b"edited");
    }

    #[test]
    fn modified_file_deleted_since_is_restored() {
        let w = World::new();
        fs::write(w.path("a.txt"), "original").unwrap();
        w.write("t", "a.txt", "edited");
        fs::remove_file(w.path("a.txt")).unwrap();
        let r = w.rewind_task("t");
        assert_eq!(w.read("a.txt").as_deref(), Some("original"));
        assert_eq!(r.undone[0].backup, None);
    }

    #[test]
    fn file_moved_goes_back() {
        let w = World::new();
        fs::write(w.path("a.pdf"), "invoice").unwrap();
        fs::create_dir(w.path("Taxes")).unwrap();
        w.mv("t", "a.pdf", "Taxes/a.pdf");
        w.rewind_task("t");
        assert_eq!(w.read("a.pdf").as_deref(), Some("invoice"));
        assert!(!w.path("Taxes/a.pdf").exists());
    }

    #[test]
    fn file_trashed_comes_back() {
        let w = World::new();
        fs::write(w.path("old.log"), "log").unwrap();
        let trash = w.e.data_dir().join("trash").join("t").join("1-old.log");
        fs::create_dir_all(trash.parent().unwrap()).unwrap();
        fs::rename(w.path("old.log"), &trash).unwrap();
        w.journal(
            "t",
            "fs.trash",
            vec![Effect::FileTrashed {
                path: w.path("old.log"),
                trashed_to: trash.clone(),
            }],
        );
        w.rewind_task("t");
        assert_eq!(w.read("old.log").as_deref(), Some("log"));
        assert!(!trash.exists());
    }

    #[test]
    fn dir_created_is_removed_only_when_empty() {
        let w = World::new();
        for name in ["empty", "used"] {
            fs::create_dir(w.path(name)).unwrap();
            w.journal(
                name,
                "fs.mkdir",
                vec![Effect::DirCreated { path: w.path(name) }],
            );
        }
        fs::write(w.path("used/keep.txt"), "mine").unwrap();
        assert_eq!(w.rewind_task("empty").undone.len(), 1);
        assert!(!w.path("empty").exists());

        let r = w.rewind_task("used");
        assert_eq!(reasons(&r.skipped), ["not empty; left in place"]);
        assert_eq!(w.read("used/keep.txt").as_deref(), Some("mine"));
    }

    #[test]
    fn nested_dir_created_removes_empty_tree_but_keeps_files() {
        let w = World::new();
        fs::create_dir_all(w.path("a/b/c")).unwrap();
        w.journal(
            "t",
            "fs.mkdir",
            vec![Effect::DirCreated { path: w.path("a") }],
        );
        assert_eq!(w.rewind_task("t").undone.len(), 1);
        assert!(!w.path("a").exists());

        fs::create_dir_all(w.path("x/y")).unwrap();
        fs::write(w.path("x/y/f.txt"), "keep").unwrap();
        w.journal(
            "u",
            "fs.mkdir",
            vec![Effect::DirCreated { path: w.path("x") }],
        );
        let r = w.rewind_task("u");
        assert_eq!(reasons(&r.skipped), ["not empty; left in place"]);
        assert_eq!(w.read("x/y/f.txt").as_deref(), Some("keep"));
    }

    #[test]
    fn kv_set_restores_or_deletes() {
        let w = World::new();
        let pre = w.e.kv_set("notes", "a", &json!(1)).unwrap();
        w.journal("t", "engram.kv_write", vec![kv_effect("a", pre)]);
        let pre = w.e.kv_set("notes", "a", &json!(2)).unwrap();
        w.journal("t", "engram.kv_write", vec![kv_effect("a", pre)]);

        let r = w.e.rewind(&RewindSelector::Seq(2)).unwrap();
        assert_eq!(w.e.kv_get("notes", "a").unwrap(), Some(json!(1)));
        let backup = r.undone[0].backup.as_deref().unwrap();
        assert_eq!(w.e.get_blob(backup).unwrap(), b"2");

        w.rewind_task("t");
        assert_eq!(w.e.kv_get("notes", "a").unwrap(), None);
    }

    fn kv_effect(key: &str, pre: Option<Value>) -> Effect {
        Effect::KvSet {
            ns: "notes".into(),
            key: key.into(),
            pre,
        }
    }

    #[test]
    fn irreversible_is_skipped_but_the_event_is_settled() {
        let w = World::new();
        let seq = w.journal(
            "t",
            "proc.spawn",
            vec![Effect::Irreversible {
                note: "ran a program".into(),
            }],
        );
        let r = w.rewind_task("t");
        assert_eq!(reasons(&r.skipped), ["irreversible: ran a program"]);
        assert_eq!(r.events, [seq]);
    }

    #[test]
    fn create_modify_move_unwinds_in_reverse_and_only_once() {
        let w = World::new();
        fs::create_dir(w.path("dest")).unwrap();
        let s1 = w.write("t", "doc.txt", "v1");
        let s2 = w.write("t", "doc.txt", "v2");
        let s3 = w.mv("t", "doc.txt", "dest/doc.txt");
        // Another task's work is untouched.
        w.write("other", "keep.txt", "keep");

        let r = w.rewind_task("t");
        let order: Vec<_> = r.undone.iter().map(|i| i.seq).collect();
        assert_eq!(order, [s3, s2, s1]);
        assert_eq!(r.events, [s3, s2, s1]);
        assert!(r.skipped.is_empty() && r.failed.is_empty());
        assert!(!w.path("doc.txt").exists());
        assert!(!w.path("dest/doc.txt").exists());
        assert_eq!(w.read("keep.txt").as_deref(), Some("keep"));
        // The last content is still recoverable from the create's backup.
        let backup = r.undone[2].backup.as_deref().unwrap();
        assert_eq!(w.e.get_blob(backup).unwrap(), b"v1");

        assert_eq!(w.rewind_task("t"), RewindReport::default());
        assert!(w.e.events(&Default::default()).unwrap().len() == 1);
    }

    #[test]
    fn a_failure_does_not_stop_the_rest_and_can_be_retried() {
        let w = World::new();
        fs::write(w.path("a.txt"), "a").unwrap();
        fs::write(w.path("b.txt"), "b").unwrap();
        let s1 = w.mv("t", "a.txt", "a2.txt");
        let s2 = w.mv("t", "b.txt", "b2.txt");
        // Something new now sits where b.txt was.
        fs::write(w.path("b.txt"), "newer b").unwrap();

        let r = w.rewind_task("t");
        assert_eq!(r.failed.len(), 1);
        assert_eq!(r.failed[0].seq, s2);
        assert!(r.failed[0].reason.contains("refusing to overwrite"));
        assert_eq!(r.events, [s1]);
        assert_eq!(w.read("a.txt").as_deref(), Some("a"));
        assert_eq!(w.read("b.txt").as_deref(), Some("newer b"));
        assert_eq!(w.read("b2.txt").as_deref(), Some("b"));

        fs::remove_file(w.path("b.txt")).unwrap();
        let r = w.rewind_task("t");
        assert_eq!(r.events, [s2]);
        assert_eq!(w.read("b.txt").as_deref(), Some("b"));
    }

    #[test]
    fn unrecoverable_effects_fail_with_reasons() {
        let w = World::new();
        fs::write(w.path("a.txt"), "now").unwrap();
        w.journal(
            "t",
            "fs.write",
            vec![
                Effect::FileModified {
                    path: w.path("a.txt"),
                    pre: "0".repeat(64),
                },
                Effect::FileCreated {
                    path: "relative.txt".into(),
                },
            ],
        );
        let r = w.rewind_task("t");
        assert_eq!(r.failed.len(), 2);
        assert!(r.failed[0].reason.contains("not absolute"));
        assert!(r.failed[1].reason.contains("pre-image unavailable"));
        assert_eq!(w.read("a.txt").as_deref(), Some("now"));
        assert!(r.events.is_empty());
    }

    #[test]
    fn already_undone_or_vanished_effects_are_skipped() {
        let w = World::new();
        w.write("t", "gone.txt", "x");
        fs::remove_file(w.path("gone.txt")).unwrap();
        fs::create_dir(w.path("d")).unwrap();
        w.journal(
            "t",
            "fs.write",
            vec![Effect::FileCreated { path: w.path("d") }],
        );
        let r = w.rewind_task("t");
        assert_eq!(
            reasons(&r.skipped),
            ["now a directory; left in place", "no longer exists"]
        );
        assert!(w.path("d").is_dir());
        assert_eq!(r.events.len(), 2);
    }

    #[test]
    fn selectors_pick_by_time_organism_and_seq_and_ignore_remote_events() {
        let w = World::new();
        let ev = |org: &str, ts: i64, name: &str| {
            fs::write(w.path(name), "x").unwrap();
            let mut e = event(
                "t",
                "fs.write",
                vec![Effect::FileCreated { path: w.path(name) }],
            );
            e.organism = org.into();
            e.ts_ms = ts;
            w.e.append(&e).unwrap()
        };
        let forge_old = ev("forge", 100, "f1");
        let notes_new = ev("notes", 200, "n1");
        let forge_new = ev("forge", 300, "f2");
        let other = ev("notes", 50, "n0");

        let mut remote = event(
            "t",
            "fs.write",
            vec![Effect::FileCreated { path: w.path("n0") }],
        );
        remote.device = "phone".into();
        remote.seq = 1;
        remote.ts_ms = 500;
        w.e.merge_remote(vec![remote]).unwrap();

        let r =
            w.e.rewind(&RewindSelector::Organism {
                name: "forge".into(),
                since_ms: 150,
            })
            .unwrap();
        assert_eq!(r.events, [forge_new]);
        let r = w.e.rewind(&RewindSelector::Since(100)).unwrap();
        assert_eq!(r.events, [notes_new, forge_old]);
        let r = w.e.rewind(&RewindSelector::Seq(other)).unwrap();
        assert_eq!(r.events, [other]);
        // The phone's event named a path on the phone; nothing left to do here.
        assert_eq!(
            w.e.rewind(&RewindSelector::Since(0)).unwrap(),
            RewindReport::default()
        );
        assert!(!w.path("f1").exists() && !w.path("f2").exists() && !w.path("n1").exists());
    }

    #[test]
    fn events_without_effects_are_left_alone() {
        let w = World::new();
        let read = w.journal("t", "fs.read", vec![]);
        w.write("t", "a.txt", "x");
        let r = w.rewind_task("t");
        assert_eq!(r.events.len(), 1);
        assert!(!w.e.event(read).unwrap().unwrap().rewound);
    }

    #[cfg(unix)]
    #[test]
    fn created_symlink_is_removed_without_touching_its_target() {
        let w = World::new();
        fs::create_dir(w.path("target")).unwrap();
        std::os::unix::fs::symlink(w.path("target"), w.path("link")).unwrap();
        w.journal(
            "t",
            "fs.write",
            vec![Effect::FileCreated {
                path: w.path("link"),
            }],
        );
        let r = w.rewind_task("t");
        assert_eq!(r.undone.len(), 1);
        assert_eq!(r.undone[0].backup, None);
        assert!(fs::symlink_metadata(w.path("link")).is_err());
        assert!(w.path("target").is_dir());
    }

    #[test]
    fn selector_serializes_compactly() {
        let s = serde_json::to_value(RewindSelector::Task("t1".into())).unwrap();
        assert_eq!(s, json!({"task": "t1"}));
        let s: RewindSelector =
            serde_json::from_value(json!({"organism": {"name": "forge", "since_ms": 5}})).unwrap();
        assert_eq!(
            s,
            RewindSelector::Organism {
                name: "forge".into(),
                since_ms: 5
            }
        );
    }
}
