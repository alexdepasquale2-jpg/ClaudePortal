//! Forget: a real deletion of memories (SPEC §3.7). The Journal is the
//! audit log and is not removed here.

use crate::{Engram, db_err};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use xz_types::{Effect, Result};

/// How many rows Forget removed.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgetReport {
    pub facts: usize,
    pub vectors: usize,
    pub kv_rows: usize,
    pub episodes: usize,
    pub blobs: usize,
}

impl Engram {
    /// Deletes memories owned by `organism`: its key-value namespace, facts
    /// it sourced, its episodes, and vectors whose id starts with
    /// `{organism}:`. Unreferenced blobs are then removed. Journal rows stay.
    pub fn forget(&self, organism: &str) -> Result<ForgetReport> {
        let mut report = ForgetReport::default();
        {
            let db = self.db();
            report.kv_rows = db
                .execute(
                    "DELETE FROM organism_state WHERE ns = ?1",
                    params![organism],
                )
                .map_err(db_err)?;
            report.facts = db
                .execute("DELETE FROM facts WHERE source = ?1", params![organism])
                .map_err(db_err)?;
            report.episodes = db
                .execute(
                    "DELETE FROM episodes WHERE organism = ?1",
                    params![organism],
                )
                .map_err(db_err)?;
        }
        report.vectors = self.delete_vectors_prefixed(&format!("{organism}:"))?;
        report.blobs = self.gc_blobs()?;
        Ok(report)
    }

    /// Deletes blob files that no Journal effect still names.
    pub fn gc_blobs(&self) -> Result<usize> {
        let keep = self.referenced_blobs()?;
        let mut removed = 0;
        for hash in self.blobs().list()? {
            if !keep.contains(&hash) && self.blobs().delete(&hash)? {
                removed += 1;
            }
        }
        Ok(removed)
    }

    fn referenced_blobs(&self) -> Result<HashSet<String>> {
        let db = self.db();
        let mut stmt = db.prepare("SELECT effects FROM events").map_err(db_err)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(db_err)?;
        let mut keep = HashSet::new();
        for row in rows {
            let raw = row.map_err(db_err)?;
            let effects: Vec<Effect> = serde_json::from_str(&raw).unwrap_or_default();
            for effect in effects {
                if let Effect::FileModified { pre, .. } = effect {
                    keep.insert(pre);
                }
            }
        }
        Ok(keep)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use xz_types::{JournalEvent, Risk, Taint, Verdict};

    #[test]
    fn forget_removes_memories_and_keeps_the_journal() {
        let eg = Engram::open_temp().unwrap();
        eg.kv_set("notes", "a", &json!(1)).unwrap();
        eg.remember("Ada", "likes", "tea", 1.0, "notes").unwrap();
        eg.upsert_vector("notes:1", "tea", &[1.0, 0.0]).unwrap();
        eg.add_episode("t", "notes", "drank tea").unwrap();
        let hash = eg.blobs().put(b"orphan").unwrap();
        let kept = eg.blobs().put(b"kept").unwrap();
        eg.append(&event_with_blob(&kept)).unwrap();

        let report = eg.forget("notes").unwrap();
        assert_eq!(report.kv_rows, 1);
        assert_eq!(report.facts, 1);
        assert_eq!(report.vectors, 1);
        assert_eq!(report.episodes, 1);
        assert_eq!(report.blobs, 1);
        assert!(eg.kv_list("notes").unwrap().is_empty());
        assert!(eg.blobs().get(&hash).is_err());
        assert_eq!(eg.blobs().get(&kept).unwrap(), b"kept");
        assert_eq!(eg.events(&Default::default()).unwrap().len(), 1);
    }

    fn event_with_blob(hash: &str) -> JournalEvent {
        JournalEvent {
            seq: 0,
            device: "other".into(),
            ts_ms: 1,
            organism: "prime".into(),
            task_id: "t".into(),
            tool: "fs.write".into(),
            args: json!({}),
            risk: Risk::Act,
            verdict: Verdict::Allowed,
            taint: Taint::none(),
            ok: true,
            summary: "wrote".into(),
            effects: vec![xz_types::Effect::FileModified {
                path: "/tmp/a".into(),
                pre: hash.into(),
            }],
            rewound: false,
        }
    }
}
