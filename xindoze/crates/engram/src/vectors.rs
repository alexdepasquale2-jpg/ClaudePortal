//! Embeddings with brute-force cosine search (SPEC §3.7).
//!
//! Vectors are stored as little-endian f32 BLOBs. A linear scan is fast
//! enough at personal scale and needs no SQLite extension.

use crate::{Engram, db_err};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use xz_types::{Result, XzError};

/// One search result. `score` is the cosine similarity, -1.0 to 1.0.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Hit {
    pub doc_id: String,
    pub text: String,
    pub score: f32,
}

impl Engram {
    /// Indexes `text` under `doc_id`, replacing any earlier entry for it.
    pub fn index(&self, doc_id: &str, text: &str, embedding: &[f32]) -> Result<()> {
        if embedding.is_empty() || embedding.iter().any(|x| !x.is_finite()) {
            return Err(XzError::InvalidArgs(
                "embedding must be non-empty and finite".into(),
            ));
        }
        let dim = i64::try_from(embedding.len())
            .map_err(|_| XzError::InvalidArgs("embedding too long".into()))?;
        self.db()
            .execute(
                "INSERT OR REPLACE INTO vectors (doc_id, text, dim, embedding, ts_ms) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![doc_id, text, dim, encode(embedding), xz_types::now_ms()],
            )
            .map_err(db_err)?;
        Ok(())
    }

    /// The `k` documents most similar to `query`, best first. Documents
    /// embedded with a different dimension (another model) are skipped.
    pub fn search(&self, query: &[f32], k: usize) -> Result<Vec<Hit>> {
        let qnorm = norm(query);
        if k == 0 || !qnorm.is_normal() {
            return Ok(Vec::new());
        }
        let dim = i64::try_from(query.len()).unwrap_or(i64::MAX);
        let db = self.db();
        let mut stmt = db
            .prepare("SELECT doc_id, text, embedding FROM vectors WHERE dim = ?1")
            .map_err(db_err)?;
        let mut rows = stmt.query([dim]).map_err(db_err)?;
        let mut hits = Vec::new();
        while let Some(r) = rows.next().map_err(db_err)? {
            let bytes = r
                .get_ref(2)
                .map_err(db_err)?
                .as_blob()
                .map_err(|e| XzError::Other(format!("engram db: bad embedding column: {e}")))?;
            let Some(score) = cosine(query, qnorm, bytes) else {
                continue;
            };
            hits.push(Hit {
                doc_id: r.get(0).map_err(db_err)?,
                text: r.get(1).map_err(db_err)?,
                score,
            });
        }
        hits.sort_by(|a, b| b.score.total_cmp(&a.score));
        hits.truncate(k);
        Ok(hits)
    }
}

fn encode(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn norm(v: &[f32]) -> f32 {
    v.iter().map(|x| x * x).sum::<f32>().sqrt()
}

/// Cosine similarity of `q` against an encoded vector, without allocating.
/// None for a length mismatch or a zero vector.
fn cosine(q: &[f32], qnorm: f32, bytes: &[u8]) -> Option<f32> {
    if bytes.len() != q.len() * 4 {
        return None;
    }
    let (mut dot, mut sq) = (0.0f32, 0.0f32);
    for (a, chunk) in q.iter().zip(bytes.chunks_exact(4)) {
        let b = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        dot += a * b;
        sq += b * b;
    }
    let score = dot / (qnorm * sq.sqrt());
    score.is_finite().then_some(score)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_by_cosine_and_skips_other_dimensions() {
        let e = Engram::open_temp().unwrap();
        e.index("north", "points north", &[0.0, 1.0, 0.0]).unwrap();
        e.index("east", "points east", &[1.0, 0.0, 0.0]).unwrap();
        e.index("ne", "points north-east", &[1.0, 1.0, 0.0])
            .unwrap();
        e.index("zero", "no direction", &[0.0, 0.0, 0.0]).unwrap();
        e.index("4d", "another model", &[1.0, 0.0, 0.0, 0.0])
            .unwrap();

        let hits = e.search(&[0.9, 0.1, 0.0], 10).unwrap();
        let ids: Vec<_> = hits.iter().map(|h| h.doc_id.as_str()).collect();
        assert_eq!(ids, ["east", "ne", "north"]);
        assert!((hits[0].score - 0.9939).abs() < 1e-3);
        assert_eq!(e.search(&[0.9, 0.1, 0.0], 1).unwrap().len(), 1);
        assert!(e.search(&[0.0, 0.0, 0.0], 5).unwrap().is_empty());
        assert!(e.search(&[1.0, 0.0], 5).unwrap().is_empty());
    }

    #[test]
    fn reindexing_replaces_the_document() {
        let e = Engram::open_temp().unwrap();
        e.index("doc", "old", &[1.0, 0.0]).unwrap();
        e.index("doc", "new", &[0.0, 1.0]).unwrap();
        let hits = e.search(&[0.0, 1.0], 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].text, "new");
        assert!((hits[0].score - 1.0).abs() < 1e-6);
        assert!(e.index("bad", "nan", &[f32::NAN]).is_err());
        assert!(e.index("bad", "empty", &[]).is_err());
    }
}
