//! Rewind: undo Journal effects (SPEC §3.5). `commit` effects are skipped.

use crate::{Engram, EventQuery};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use xz_types::{Effect, Result, XzError};

/// Which events to undo. Newest matching events are undone first.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "by", rename_all = "snake_case")]
pub enum RewindSelector {
    Task {
        task_id: String,
    },
    Last {
        organism: Option<String>,
        n: usize,
    },
    Since {
        organism: Option<String>,
        since_ms: i64,
    },
}

/// One event Rewind considered.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RewindItem {
    pub seq: i64,
    pub summary: String,
}

/// What Rewind did.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RewindReport {
    pub undone: Vec<RewindItem>,
    pub skipped: Vec<RewindItem>,
    pub failed: Vec<RewindItem>,
}

impl Engram {
    /// Undoes the effects of matching events. An event is marked rewound only
    /// when every reversible effect succeeded. Irreversible effects are skipped
    /// and do not by themselves mark the event.
    pub fn rewind(&self, selector: &RewindSelector) -> Result<RewindReport> {
        let _guard = self.rewind_lock.lock().unwrap_or_else(|e| e.into_inner());
        let events = self.events(&query(selector))?;
        let mut report = RewindReport::default();
        for ev in events {
            let mut reversible = 0;
            let mut failed = false;
            let mut notes = Vec::new();
            for effect in ev.effects.iter().rev() {
                match effect {
                    Effect::Irreversible { note } => notes.push(format!("skipped: {note}")),
                    other => {
                        reversible += 1;
                        if let Err(e) = apply(self, other) {
                            failed = true;
                            notes.push(format!("{e}"));
                        }
                    }
                }
            }
            let item = RewindItem {
                seq: ev.seq,
                summary: if notes.is_empty() {
                    ev.summary.clone()
                } else {
                    format!("{} ({})", ev.summary, notes.join("; "))
                },
            };
            if reversible == 0 {
                report.skipped.push(item);
                continue;
            }
            if failed {
                report.failed.push(item);
                continue;
            }
            self.mark_rewound(ev.seq)?;
            report.undone.push(item);
        }
        Ok(report)
    }
}

fn query(selector: &RewindSelector) -> EventQuery {
    match selector {
        RewindSelector::Task { task_id } => EventQuery {
            task_id: Some(task_id.clone()),
            limit: 10_000,
            ..EventQuery::default()
        },
        RewindSelector::Last { organism, n } => EventQuery {
            organism: organism.clone(),
            limit: *n,
            ..EventQuery::default()
        },
        RewindSelector::Since { organism, since_ms } => EventQuery {
            organism: organism.clone(),
            since_ms: Some(*since_ms),
            limit: 10_000,
            ..EventQuery::default()
        },
    }
}

fn apply(eg: &Engram, effect: &Effect) -> Result<()> {
    match effect {
        Effect::FileCreated { path } => remove_file_if_present(path),
        Effect::DirCreated { path } => remove_empty_dir(path),
        Effect::FileModified { path, pre } => {
            refuse_symlink(path)?;
            let bytes = eg.blobs().get(pre)?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(path, bytes)?;
            Ok(())
        }
        Effect::FileMoved { from, to } => {
            refuse_symlink(to)?;
            if let Some(parent) = from.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(to, from)?;
            Ok(())
        }
        Effect::FileTrashed { path, trashed_to } => {
            refuse_symlink(trashed_to)?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(trashed_to, path)?;
            Ok(())
        }
        Effect::KvSet { ns, key, pre } => match pre {
            Some(v) => {
                eg.kv_set(ns, key, v)?;
                Ok(())
            }
            None => {
                eg.kv_delete(ns, key)?;
                Ok(())
            }
        },
        Effect::Irreversible { .. } => Ok(()),
    }
}

fn refuse_symlink(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(XzError::InvalidArgs(format!(
            "{} is a symlink; rewind will not follow it",
            path.display()
        ))),
        _ => Ok(()),
    }
}

fn remove_file_if_present(path: &Path) -> Result<()> {
    refuse_symlink(path)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn remove_empty_dir(path: &Path) -> Result<()> {
    match fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(XzError::Other(format!(
            "could not remove {}: {e}",
            path.display()
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use xz_types::{JournalEvent, Risk, Taint, Verdict};

    fn base(tool: &str, effects: Vec<Effect>) -> JournalEvent {
        JournalEvent {
            seq: 0,
            device: String::new(),
            ts_ms: 1,
            organism: "prime".into(),
            task_id: "task".into(),
            tool: tool.into(),
            args: json!({}),
            risk: Risk::Act,
            verdict: Verdict::Allowed,
            taint: Taint::none(),
            ok: true,
            summary: tool.into(),
            effects,
            rewound: false,
        }
    }

    #[test]
    fn rewind_restores_files_and_kv() {
        let eg = Engram::open_temp().unwrap();
        let dir = eg.data_dir().join("work");
        fs::create_dir_all(&dir).unwrap();
        let created = dir.join("new.txt");
        fs::write(&created, b"new").unwrap();
        let edited = dir.join("old.txt");
        fs::write(&edited, b"after").unwrap();
        let pre = eg.blobs().put(b"before").unwrap();
        let folder = dir.join("made");
        fs::create_dir_all(&folder).unwrap();
        eg.kv_set("notes", "k", &json!(2)).unwrap();

        eg.append(&base(
            "fs.write",
            vec![Effect::FileCreated {
                path: created.clone(),
            }],
        ))
        .unwrap();
        eg.append(&base(
            "fs.write",
            vec![Effect::FileModified {
                path: edited.clone(),
                pre,
            }],
        ))
        .unwrap();
        eg.append(&base(
            "fs.mkdir",
            vec![Effect::DirCreated {
                path: folder.clone(),
            }],
        ))
        .unwrap();
        eg.append(&base(
            "engram.kv_write",
            vec![Effect::KvSet {
                ns: "notes".into(),
                key: "k".into(),
                pre: Some(json!(1)),
            }],
        ))
        .unwrap();
        eg.append(&base(
            "net.post",
            vec![Effect::Irreversible {
                note: "sent".into(),
            }],
        ))
        .unwrap();

        let report = eg
            .rewind(&RewindSelector::Task {
                task_id: "task".into(),
            })
            .unwrap();
        assert_eq!(report.undone.len(), 4);
        assert_eq!(report.skipped.len(), 1);
        assert!(report.failed.is_empty());
        assert!(!created.exists());
        assert_eq!(fs::read(&edited).unwrap(), b"before");
        assert!(!folder.exists());
        assert_eq!(eg.kv_get("notes", "k").unwrap(), Some(json!(1)));
        // A second rewind finds nothing left.
        let again = eg
            .rewind(&RewindSelector::Task {
                task_id: "task".into(),
            })
            .unwrap();
        assert!(again.undone.is_empty());
    }
}
