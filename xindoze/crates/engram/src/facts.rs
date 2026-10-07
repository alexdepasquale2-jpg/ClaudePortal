//! Subject–predicate–object facts (SPEC §3.7).

use crate::{Engram, db_err};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use xz_types::{Result, XzError, now_ms};

/// One remembered fact.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Fact {
    pub id: i64,
    pub subject: String,
    pub predicate: String,
    pub object: String,
    pub confidence: f64,
    pub source: String,
    pub ts_ms: i64,
}

impl Engram {
    /// Inserts a fact, or replaces confidence and source when the triple exists.
    pub fn remember(
        &self,
        subject: &str,
        predicate: &str,
        object: &str,
        confidence: f64,
        source: &str,
    ) -> Result<Fact> {
        if !(0.0..=1.0).contains(&confidence) {
            return Err(XzError::InvalidArgs(
                "confidence must be between 0 and 1".into(),
            ));
        }
        for (name, v) in [
            ("subject", subject),
            ("predicate", predicate),
            ("object", object),
        ] {
            if v.trim().is_empty() {
                return Err(XzError::InvalidArgs(format!("{name} is empty")));
            }
        }
        let ts = now_ms();
        self.db()
            .execute(
                "INSERT INTO facts (subject, predicate, object, confidence, source, ts_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(subject, predicate, object) DO UPDATE SET
                   confidence = excluded.confidence,
                   source = excluded.source,
                   ts_ms = excluded.ts_ms",
                params![subject, predicate, object, confidence, source, ts],
            )
            .map_err(db_err)?;
        self.facts_about(subject)?
            .into_iter()
            .find(|f| f.subject == subject && f.predicate == predicate && f.object == object)
            .ok_or_else(|| XzError::Other("fact vanished after insert".into()))
    }

    /// Facts whose subject matches `subject`, case-insensitively.
    pub fn facts_about(&self, subject: &str) -> Result<Vec<Fact>> {
        let db = self.db();
        let mut stmt = db
            .prepare(
                "SELECT id, subject, predicate, object, confidence, source, ts_ms
                 FROM facts WHERE subject = ?1 COLLATE NOCASE ORDER BY id",
            )
            .map_err(db_err)?;
        let rows = stmt.query_map(params![subject], fact_row).map_err(db_err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_err)
    }

    /// Deletes one fact. Returns whether a row was removed.
    pub fn forget_fact(&self, id: i64) -> Result<bool> {
        let n = self
            .db()
            .execute("DELETE FROM facts WHERE id = ?1", [id])
            .map_err(db_err)?;
        Ok(n > 0)
    }
}

fn fact_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Fact> {
    Ok(Fact {
        id: r.get(0)?,
        subject: r.get(1)?,
        predicate: r.get(2)?,
        object: r.get(3)?,
        confidence: r.get(4)?,
        source: r.get(5)?,
        ts_ms: r.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remember_upserts_the_triple() {
        let eg = Engram::open_temp().unwrap();
        let a = eg.remember("Ada", "likes", "tea", 0.4, "prime").unwrap();
        let b = eg.remember("Ada", "likes", "tea", 0.9, "prime").unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(b.confidence, 0.9);
        assert_eq!(eg.facts_about("ADA").unwrap().len(), 1);
        assert!(eg.forget_fact(a.id).unwrap());
        assert!(eg.facts_about("Ada").unwrap().is_empty());
        assert!(eg.remember("", "likes", "tea", 1.0, "p").is_err());
        assert!(eg.remember("A", "likes", "tea", 1.5, "p").is_err());
    }
}
