//! Per-Organism key-value state (`organism_state`, SPEC §3.7).

use crate::{Engram, db_err};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use xz_types::Result;

impl Engram {
    /// The value stored under `key` in namespace `ns`.
    pub fn kv_get(&self, ns: &str, key: &str) -> Result<Option<Value>> {
        get(&self.db(), ns, key)
    }

    /// Stores `value` and returns the previous value, which callers record
    /// as an `Effect::KvSet` so Rewind can restore it.
    pub fn kv_set(&self, ns: &str, key: &str, value: &Value) -> Result<Option<Value>> {
        let text = serde_json::to_string(value)?;
        let mut db = self.db();
        let tx = db.transaction().map_err(db_err)?;
        let prev = get(&tx, ns, key)?;
        tx.execute(
            "INSERT INTO organism_state (ns, key, value, updated_ms) VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT (ns, key) DO UPDATE SET value = excluded.value, \
             updated_ms = excluded.updated_ms",
            params![ns, key, text, xz_types::now_ms()],
        )
        .map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(prev)
    }

    /// Deletes `key` and returns the value it held.
    pub fn kv_delete(&self, ns: &str, key: &str) -> Result<Option<Value>> {
        let text: Option<String> = self
            .db()
            .query_row(
                "DELETE FROM organism_state WHERE ns = ?1 AND key = ?2 RETURNING value",
                [ns, key],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?;
        Ok(text.map(|t| serde_json::from_str(&t)).transpose()?)
    }

    /// Entries of `ns` whose key starts with `prefix` (empty for all),
    /// sorted by key.
    pub fn kv_list(&self, ns: &str, prefix: &str) -> Result<Vec<(String, Value)>> {
        let db = self.db();
        // substr instead of LIKE, so `%` and `_` in a prefix are literal.
        let mut stmt = db
            .prepare(
                "SELECT key, value FROM organism_state \
                 WHERE ns = ?1 AND substr(key, 1, length(?2)) = ?2 ORDER BY key",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map([ns, prefix], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(db_err)?;
        rows.map(|row| {
            let (key, text) = row.map_err(db_err)?;
            Ok((key, serde_json::from_str(&text)?))
        })
        .collect()
    }
}

fn get(db: &Connection, ns: &str, key: &str) -> Result<Option<Value>> {
    let text: Option<String> = db
        .query_row(
            "SELECT value FROM organism_state WHERE ns = ?1 AND key = ?2",
            [ns, key],
            |r| r.get(0),
        )
        .optional()
        .map_err(db_err)?;
    Ok(text.map(|t| serde_json::from_str(&t)).transpose()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn set_returns_previous_and_namespaces_are_separate() {
        let e = Engram::open_temp().unwrap();
        assert_eq!(e.kv_set("notes", "a", &json!(1)).unwrap(), None);
        assert_eq!(
            e.kv_set("notes", "a", &json!({"x": 2})).unwrap(),
            Some(json!(1))
        );
        assert_eq!(e.kv_get("notes", "a").unwrap(), Some(json!({"x": 2})));
        assert_eq!(e.kv_get("water", "a").unwrap(), None);

        assert_eq!(e.kv_delete("notes", "a").unwrap(), Some(json!({"x": 2})));
        assert_eq!(e.kv_delete("notes", "a").unwrap(), None);
        assert_eq!(e.kv_get("notes", "a").unwrap(), None);
    }

    #[test]
    fn list_filters_by_literal_prefix() {
        let e = Engram::open_temp().unwrap();
        for k in ["day:2", "day:1", "dayx", "d%y:3", "other"] {
            e.kv_set("w", k, &json!(k)).unwrap();
        }
        e.kv_set("v", "day:9", &json!(0)).unwrap();
        let keys: Vec<_> = e
            .kv_list("w", "day:")
            .unwrap()
            .into_iter()
            .map(|(k, _)| k)
            .collect();
        assert_eq!(keys, ["day:1", "day:2"]);
        assert_eq!(e.kv_list("w", "d%").unwrap().len(), 1);
        assert_eq!(e.kv_list("w", "").unwrap().len(), 5);
    }
}
