//! Brute-force cosine search over embedding BLOBs (SPEC §3.7).
//! Personal scale does not need a vector extension.

use crate::{Engram, db_err};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use xz_types::{Result, XzError, now_ms};

/// One neighbor from [`Engram::search_vectors`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Hit {
    pub doc_id: String,
    pub text: String,
    pub score: f32,
}

impl Engram {
    /// Inserts or replaces the embedding for `doc_id`.
    pub fn upsert_vector(&self, doc_id: &str, text: &str, embedding: &[f32]) -> Result<()> {
        if doc_id.is_empty() {
            return Err(XzError::InvalidArgs("doc_id is empty".into()));
        }
        if embedding.is_empty() {
            return Err(XzError::InvalidArgs("embedding is empty".into()));
        }
        let blob = encode(embedding);
        self.db()
            .execute(
                "INSERT INTO vectors (doc_id, text, dim, embedding, ts_ms) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(doc_id) DO UPDATE SET
                   text = excluded.text, dim = excluded.dim,
                   embedding = excluded.embedding, ts_ms = excluded.ts_ms",
                params![doc_id, text, embedding.len() as i64, blob, now_ms()],
            )
            .map_err(db_err)?;
        Ok(())
    }

    /// The `k` nearest documents by cosine similarity, highest first.
    /// An empty query or an empty store returns no hits. Dimension mismatches
    /// are skipped.
    pub fn search_vectors(&self, query: &[f32], k: usize) -> Result<Vec<Hit>> {
        if k == 0 || query.is_empty() {
            return Ok(vec![]);
        }
        let db = self.db();
        let mut stmt = db
            .prepare("SELECT doc_id, text, dim, embedding FROM vectors")
            .map_err(db_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, Vec<u8>>(3)?,
                ))
            })
            .map_err(db_err)?;
        let mut hits = Vec::new();
        for row in rows {
            let (doc_id, text, dim, blob) = row.map_err(db_err)?;
            if dim as usize != query.len() {
                continue;
            }
            let emb = decode(&blob, dim as usize)?;
            hits.push(Hit {
                doc_id,
                text,
                score: cosine(query, &emb),
            });
        }
        hits.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.doc_id.cmp(&b.doc_id)));
        hits.truncate(k);
        Ok(hits)
    }

    /// Deletes one vector. Returns whether a row was removed.
    pub fn delete_vector(&self, doc_id: &str) -> Result<bool> {
        let n = self
            .db()
            .execute("DELETE FROM vectors WHERE doc_id = ?1", [doc_id])
            .map_err(db_err)?;
        Ok(n > 0)
    }

    pub(crate) fn delete_vectors_prefixed(&self, prefix: &str) -> Result<usize> {
        let n = self
            .db()
            .execute(
                "DELETE FROM vectors WHERE doc_id LIKE ?1 ESCAPE '\\'",
                [like_prefix(prefix)],
            )
            .map_err(db_err)?;
        Ok(n)
    }
}

fn like_prefix(prefix: &str) -> String {
    let mut s = prefix
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    s.push('%');
    s
}

fn encode(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for n in v {
        out.extend_from_slice(&n.to_le_bytes());
    }
    out
}

fn decode(blob: &[u8], dim: usize) -> Result<Vec<f32>> {
    if blob.len() != dim * 4 {
        return Err(XzError::Parse("embedding blob length".into()));
    }
    let mut out = Vec::with_capacity(dim);
    for i in 0..dim {
        let mut buf = [0u8; 4];
        buf.copy_from_slice(&blob[i * 4..i * 4 + 4]);
        out.push(f32::from_le_bytes(buf));
    }
    Ok(out)
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (x, y) in a.iter().zip(b) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 { 0.0 } else { dot / denom }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_neighbor_is_the_same_direction() {
        let eg = Engram::open_temp().unwrap();
        eg.upsert_vector("a", "alpha", &[1.0, 0.0]).unwrap();
        eg.upsert_vector("b", "beta", &[0.0, 1.0]).unwrap();
        eg.upsert_vector("c", "other dim", &[1.0, 0.0, 0.0])
            .unwrap();
        let hits = eg.search_vectors(&[1.0, 0.1], 2).unwrap();
        assert_eq!(hits[0].doc_id, "a");
        assert!(hits[0].score > hits[1].score);
        assert!(hits.iter().all(|h| h.doc_id != "c"));
        assert!(eg.delete_vector("a").unwrap());
        assert!(
            eg.search_vectors(&[1.0, 0.0], 5)
                .unwrap()
                .iter()
                .all(|h| h.doc_id != "a")
        );
        assert!(eg.upsert_vector("", "x", &[1.0]).is_err());
        assert!(eg.search_vectors(&[], 3).unwrap().is_empty());
    }
}
