//! Subject–predicate–object facts with confidence and source (SPEC §3.7).

use crate::{Engram, db_err, sql_limit};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use xz_types::Result;

/// One remembered fact, e.g. ("Alex", "prefers", "dark mode").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Fact {
    pub subject: String,
    pub predicate: String,
    pub object: String,
    /// 0.0 to 1.0.
    pub confidence: f64,
    /// Where the fact came from, e.g. an Organism name or `user`.
    pub source: String,
}

/// A stored fact with its id and the time it was last remembered.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FactRecord {
    pub id: i64,
    pub ts_ms: i64,
    #[serde(flatten)]
    pub fact: Fact,
}

impl Engram {
    /// Stores a fact and returns its id. Remembering the same triple again
    /// updates its confidence and source instead of duplicating it.
    pub fn remember(&self, f: &Fact) -> Result<i64> {
        self.db()
            .query_row(
                "INSERT INTO facts (subject, predicate, object, confidence, source, ts_ms) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
                 ON CONFLICT (subject, predicate, object) DO UPDATE SET \
                 confidence = excluded.confidence, source = excluded.source, \
                 ts_ms = excluded.ts_ms \
                 RETURNING id",
                params![
                    f.subject,
                    f.predicate,
                    f.object,
                    f.confidence,
                    f.source,
                    xz_types::now_ms()
                ],
                |r| r.get(0),
            )
            .map_err(db_err)
    }

    /// Facts about `subject` (ASCII case-insensitive), or all facts, newest
    /// first.
    pub fn facts(&self, subject: Option<&str>, limit: usize) -> Result<Vec<FactRecord>> {
        let db = self.db();
        let mut stmt = db
            .prepare(
                "SELECT id, ts_ms, subject, predicate, object, confidence, source FROM facts \
                 WHERE ?1 IS NULL OR subject = ?1 COLLATE NOCASE \
                 ORDER BY ts_ms DESC, id DESC LIMIT ?2",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![subject, sql_limit(limit)], |r| {
                Ok(FactRecord {
                    id: r.get(0)?,
                    ts_ms: r.get(1)?,
                    fact: Fact {
                        subject: r.get(2)?,
                        predicate: r.get(3)?,
                        object: r.get(4)?,
                        confidence: r.get(5)?,
                        source: r.get(6)?,
                    },
                })
            })
            .map_err(db_err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fact(s: &str, p: &str, o: &str, c: f64) -> Fact {
        Fact {
            subject: s.into(),
            predicate: p.into(),
            object: o.into(),
            confidence: c,
            source: "user".into(),
        }
    }

    #[test]
    fn remember_upserts_and_filters_by_subject() {
        let e = Engram::open_temp().unwrap();
        let id = e.remember(&fact("Alex", "likes", "tea", 0.5)).unwrap();
        e.remember(&fact("Sam", "likes", "coffee", 0.9)).unwrap();
        assert_eq!(e.remember(&fact("Alex", "likes", "tea", 0.8)).unwrap(), id);

        let alex = e.facts(Some("alex"), 10).unwrap();
        assert_eq!(alex.len(), 1);
        assert_eq!(alex[0].id, id);
        assert_eq!(alex[0].fact.confidence, 0.8);
        assert_eq!(e.facts(None, 10).unwrap().len(), 2);
        assert_eq!(e.facts(None, 1).unwrap().len(), 1);
    }
}
