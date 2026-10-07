//! Per-Organism key-value store (`organism_state`).

use crate::{Engram, db_err};
use rusqlite::{OptionalExtension, params};
use serde_json::Value;
use xz_types::{Result, XzError, now_ms};

impl Engram {
    /// The value stored at `(ns, key)`, if any.
    pub fn kv_get(&self, ns: &str, key: &str) -> Result<Option<Value>> {
        check_key(ns, key)?;
        let db = self.db();
        let raw: Option<String> = db
            .query_row(
                "SELECT value FROM organism_state WHERE ns = ?1 AND key = ?2",
                params![ns, key],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?;
        raw.map(|s| serde_json::from_str(&s).map_err(|e| XzError::Parse(e.to_string())))
            .transpose()
    }

    /// Sets `(ns, key)` and returns the previous value.
    pub fn kv_set(&self, ns: &str, key: &str, value: &Value) -> Result<Option<Value>> {
        check_key(ns, key)?;
        let prev = self.kv_get(ns, key)?;
        let raw = serde_json::to_string(value)?;
        self.db()
            .execute(
                "INSERT INTO organism_state (ns, key, value, updated_ms) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
                params![ns, key, raw, now_ms()],
            )
            .map_err(db_err)?;
        Ok(prev)
    }

    /// Removes `(ns, key)` and returns the previous value.
    pub fn kv_delete(&self, ns: &str, key: &str) -> Result<Option<Value>> {
        check_key(ns, key)?;
        let prev = self.kv_get(ns, key)?;
        self.db()
            .execute(
                "DELETE FROM organism_state WHERE ns = ?1 AND key = ?2",
                params![ns, key],
            )
            .map_err(db_err)?;
        Ok(prev)
    }

    /// Every key in `ns`, in key order.
    pub fn kv_list(&self, ns: &str) -> Result<Vec<(String, Value)>> {
        check_key(ns, "k")?;
        let db = self.db();
        let mut stmt = db
            .prepare("SELECT key, value FROM organism_state WHERE ns = ?1 ORDER BY key")
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![ns], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(db_err)?;
        rows.map(|row| {
            let (k, raw): (String, String) = row.map_err(db_err)?;
            let v = serde_json::from_str(&raw)?;
            Ok((k, v))
        })
        .collect()
    }
}

fn check_key(ns: &str, key: &str) -> Result<()> {
    if ns.is_empty() || key.is_empty() || ns.contains('\0') || key.contains('\0') {
        return Err(XzError::InvalidArgs(
            "namespace and key must be non-empty".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn set_get_list_delete() {
        let eg = Engram::open_temp().unwrap();
        assert_eq!(eg.kv_get("notes", "a").unwrap(), None);
        assert_eq!(eg.kv_set("notes", "a", &json!(1)).unwrap(), None);
        assert_eq!(eg.kv_set("notes", "a", &json!(2)).unwrap(), Some(json!(1)));
        eg.kv_set("notes", "b", &json!("x")).unwrap();
        eg.kv_set("other", "a", &json!(0)).unwrap();
        assert_eq!(
            eg.kv_list("notes").unwrap(),
            vec![("a".into(), json!(2)), ("b".into(), json!("x"))]
        );
        assert_eq!(eg.kv_delete("notes", "a").unwrap(), Some(json!(2)));
        assert_eq!(eg.kv_get("notes", "a").unwrap(), None);
        assert!(eg.kv_set("", "a", &json!(1)).is_err());
    }
}
