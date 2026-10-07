//! Session summaries (SPEC §3.7). The Context Pager writes these when a
//! working set overflows. TODO(phase 1): the pager itself.

use crate::{Engram, db_err, sql_limit};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use xz_types::{Result, XzError, now_ms};

/// A summarized session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Episode {
    pub id: i64,
    pub task_id: String,
    pub organism: String,
    pub summary: String,
    pub ts_ms: i64,
}

impl Engram {
    /// Appends an episode and returns it with its id.
    pub fn add_episode(
        &self,
        task_id: impl Into<String>,
        organism: impl Into<String>,
        summary: impl Into<String>,
    ) -> Result<Episode> {
        let task_id = task_id.into();
        let organism = organism.into();
        let summary = summary.into();
        if task_id.is_empty() || organism.is_empty() || summary.trim().is_empty() {
            return Err(XzError::InvalidArgs(
                "episode needs a task, organism and summary".into(),
            ));
        }
        let ts = now_ms();
        let db = self.db();
        db.execute(
            "INSERT INTO episodes (task_id, organism, summary, ts_ms) VALUES (?1, ?2, ?3, ?4)",
            params![task_id, organism, summary, ts],
        )
        .map_err(db_err)?;
        Ok(Episode {
            id: db.last_insert_rowid(),
            task_id,
            organism,
            summary,
            ts_ms: ts,
        })
    }

    /// Newest episodes first.
    pub fn episodes(&self, limit: usize) -> Result<Vec<Episode>> {
        let db = self.db();
        let mut stmt = db
            .prepare(
                "SELECT id, task_id, organism, summary, ts_ms FROM episodes
                 ORDER BY ts_ms DESC, id DESC LIMIT ?1",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map([sql_limit(limit)], |r| {
                Ok(Episode {
                    id: r.get(0)?,
                    task_id: r.get(1)?,
                    organism: r.get(2)?,
                    summary: r.get(3)?,
                    ts_ms: r.get(4)?,
                })
            })
            .map_err(db_err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_first() {
        let eg = Engram::open_temp().unwrap();
        let a = eg.add_episode("t1", "prime", "first").unwrap();
        let b = eg.add_episode("t2", "prime", "second").unwrap();
        let list = eg.episodes(10).unwrap();
        assert_eq!(list[0].id, b.id);
        assert_eq!(list[1].id, a.id);
        assert_eq!(eg.episodes(1).unwrap().len(), 1);
        assert!(eg.add_episode("", "prime", "x").is_err());
    }
}
