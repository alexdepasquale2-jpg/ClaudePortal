//! Forget: real deletion of memories that mention something (SPEC §3.7).

use crate::{Engram, db_err};
use rusqlite::{Transaction, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use xz_types::{Result, XzError};

/// How many rows of each kind [`Engram::forget`] deleted.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgetReport {
    pub facts: usize,
    pub vectors: usize,
    pub episodes: usize,
    pub kv: usize,
}

impl ForgetReport {
    /// Total rows deleted.
    pub fn total(&self) -> usize {
        self.facts + self.vectors + self.episodes + self.kv
    }
}

impl Engram {
    /// Deletes every fact, vector, episode and KV entry whose text contains
    /// `query` (case-insensitive). The Journal is left intact: it is the
    /// audit trail Rewind depends on.
    ///
    /// Deleted content is zeroed in the database file (`secure_delete`) and
    /// the WAL is truncated, so the text does not linger on disk.
    pub fn forget(&self, query: &str) -> Result<ForgetReport> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Err(XzError::InvalidArgs(
                "forget needs a non-empty query".into(),
            ));
        }
        let hit = |s: &str| s.to_lowercase().contains(&needle);
        let mut db = self.db();
        let tx = db.transaction().map_err(db_err)?;
        let report = ForgetReport {
            facts: delete_matching(
                &tx,
                "SELECT rowid, subject || ' ' || predicate || ' ' || object || ' ' || source \
                 FROM facts",
                "facts",
                |text| hit(text),
            )?,
            vectors: delete_matching(
                &tx,
                "SELECT rowid, doc_id || ' ' || text FROM vectors",
                "vectors",
                |text| hit(text),
            )?,
            episodes: delete_matching(
                &tx,
                "SELECT rowid, summary FROM episodes",
                "episodes",
                |text| hit(text),
            )?,
            kv: delete_kv(&tx, &hit)?,
        };
        tx.commit().map_err(db_err)?;
        // Committed pages still sit in the WAL until a checkpoint copies them
        // back; TRUNCATE also empties the WAL file itself.
        db.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
            .map_err(db_err)?;
        Ok(report)
    }
}

/// Deletes the rows of `table` whose text (column 2 of `select`) matches.
fn delete_matching(
    tx: &Transaction<'_>,
    select: &str,
    table: &str,
    matches: impl Fn(&str) -> bool,
) -> Result<usize> {
    let ids = {
        let mut stmt = tx.prepare(select).map_err(db_err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(db_err)?;
        let mut ids = Vec::new();
        for row in rows {
            let (id, text) = row.map_err(db_err)?;
            if matches(&text) {
                ids.push(id);
            }
        }
        ids
    };
    let mut stmt = tx
        .prepare(&format!("DELETE FROM {table} WHERE rowid = ?1"))
        .map_err(db_err)?;
    for id in &ids {
        stmt.execute([id]).map_err(db_err)?;
    }
    Ok(ids.len())
}

/// `organism_state` is WITHOUT ROWID, so it is keyed by `(ns, key)`.
fn delete_kv(tx: &Transaction<'_>, hit: &impl Fn(&str) -> bool) -> Result<usize> {
    let doomed = {
        let mut stmt = tx
            .prepare("SELECT ns, key, value FROM organism_state")
            .map_err(db_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(db_err)?;
        let mut doomed = Vec::new();
        for row in rows {
            let (ns, key, text) = row.map_err(db_err)?;
            let value: Value = serde_json::from_str(&text)?;
            if hit(&key) || value_mentions(&value, hit) {
                doomed.push([ns, key]);
            }
        }
        doomed
    };
    let mut stmt = tx
        .prepare("DELETE FROM organism_state WHERE ns = ?1 AND key = ?2")
        .map_err(db_err)?;
    for pk in &doomed {
        stmt.execute(params_from_iter(pk)).map_err(db_err)?;
    }
    Ok(doomed.len())
}

/// Matches the text a person would see in a value (keys and leaves), not
/// its JSON escaping.
fn value_mentions(v: &Value, hit: &impl Fn(&str) -> bool) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => hit(&b.to_string()),
        Value::Number(n) => hit(&n.to_string()),
        Value::String(s) => hit(s),
        Value::Array(items) => items.iter().any(|i| value_mentions(i, hit)),
        Value::Object(map) => map.iter().any(|(k, i)| hit(k) || value_mentions(i, hit)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Episode, Fact};
    use serde_json::json;

    const SECRET: &str = "Zanzibar-7781";

    #[test]
    fn forget_deletes_matches_everywhere_and_leaves_nothing_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let e = Engram::open(dir.path(), "pc").unwrap();
        e.remember(&Fact {
            subject: "door code".into(),
            predicate: "is".into(),
            object: SECRET.into(),
            confidence: 1.0,
            source: "user".into(),
        })
        .unwrap();
        e.remember(&Fact {
            subject: "sky".into(),
            predicate: "is".into(),
            object: "blue".into(),
            confidence: 1.0,
            source: "user".into(),
        })
        .unwrap();
        e.index("note:1", &format!("the code is {SECRET}"), &[1.0, 0.0])
            .unwrap();
        e.index("note:2", "groceries", &[0.0, 1.0]).unwrap();
        e.add_episode(&Episode {
            task_id: "t1".into(),
            organism: "notes".into(),
            summary: format!("user shared {SECRET}"),
            ts_ms: 1,
        })
        .unwrap();
        e.kv_set("notes", "n1", &json!({"body": ["x", SECRET]}))
            .unwrap();
        e.kv_set("notes", "n2", &json!({"body": "milk"})).unwrap();

        // Case-insensitive.
        let report = e.forget("zanzibar").unwrap();
        assert_eq!(
            report,
            ForgetReport {
                facts: 1,
                vectors: 1,
                episodes: 1,
                kv: 1
            }
        );
        assert_eq!(report.total(), 4);
        assert_eq!(e.facts(None, 10).unwrap().len(), 1);
        assert_eq!(e.search(&[0.0, 1.0], 10).unwrap().len(), 1);
        assert!(e.recent_episodes(10).unwrap().is_empty());
        assert_eq!(e.kv_list("notes", "").unwrap().len(), 1);
        assert_eq!(e.forget("zanzibar").unwrap().total(), 0);

        // A real deletion: the bytes are gone from every database file.
        for name in ["engram.db", "engram.db-wal"] {
            let path = dir.path().join(name);
            if let Ok(bytes) = std::fs::read(&path) {
                let found = bytes.windows(SECRET.len()).any(|w| w == SECRET.as_bytes());
                assert!(!found, "{name} still holds the forgotten text");
            }
        }
    }

    #[test]
    fn empty_query_is_refused() {
        let e = Engram::open_temp().unwrap();
        assert!(e.forget("  ").is_err());
    }
}
