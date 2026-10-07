//! Episodes: summarized sessions the Context Pager recalls (SPEC §3.7).

use crate::{Engram, db_err, sql_limit};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use xz_types::Result;

/// A summary of one task or session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Episode {
    pub task_id: String,
    pub organism: String,
    pub summary: String,
    pub ts_ms: i64,
}

impl Engram {
    /// Stores an episode and returns its id.
    pub fn add_episode(&self, ep: &Episode) -> Result<i64> {
        let db = self.db();
        db.execute(
            "INSERT INTO episodes (task_id, organism, summary, ts_ms) VALUES (?1, ?2, ?3, ?4)",
            params![ep.task_id, ep.organism, ep.summary, ep.ts_ms],
        )
        .map_err(db_err)?;
        Ok(db.last_insert_rowid())
    }

    /// The `n` most recent episodes, newest first.
    pub fn recent_episodes(&self, n: usize) -> Result<Vec<Episode>> {
        let db = self.db();
        let mut stmt = db
            .prepare(
                "SELECT task_id, organism, summary, ts_ms FROM episodes \
                 ORDER BY ts_ms DESC, id DESC LIMIT ?1",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map([sql_limit(n)], |r| {
                Ok(Episode {
                    task_id: r.get(0)?,
                    organism: r.get(1)?,
                    summary: r.get(2)?,
                    ts_ms: r.get(3)?,
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
    fn recent_episodes_are_newest_first() {
        let e = Engram::open_temp().unwrap();
        for (i, ts) in [30, 10, 20].into_iter().enumerate() {
            e.add_episode(&Episode {
                task_id: format!("t{i}"),
                organism: "notes".into(),
                summary: format!("episode at {ts}"),
                ts_ms: ts,
            })
            .unwrap();
        }
        let got: Vec<_> = e
            .recent_episodes(2)
            .unwrap()
            .into_iter()
            .map(|ep| ep.ts_ms)
            .collect();
        assert_eq!(got, [30, 20]);
    }
}
