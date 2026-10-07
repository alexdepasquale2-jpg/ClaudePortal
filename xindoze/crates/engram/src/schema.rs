//! Connection setup and schema migrations, versioned by `user_version`.

use crate::db_err;
use rusqlite::Connection;
use std::time::Duration;
use xz_types::{Result, XzError};

/// Migration `i` takes the schema from version `i` to `i + 1`. Append only.
const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    device     TEXT NOT NULL,
    -- The seq on the device that produced the event; equals seq for local events.
    origin_seq INTEGER,
    ts_ms      INTEGER NOT NULL,
    organism   TEXT NOT NULL,
    task_id    TEXT NOT NULL,
    tool       TEXT NOT NULL,
    args       TEXT NOT NULL,
    risk       TEXT NOT NULL,
    verdict    TEXT NOT NULL,
    taint      TEXT NOT NULL,
    ok         INTEGER NOT NULL,
    summary    TEXT NOT NULL,
    effects    TEXT NOT NULL,
    rewound    INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX events_origin ON events(device, origin_seq);
CREATE INDEX events_task ON events(task_id);
CREATE INDEX events_ts ON events(ts_ms);

CREATE TABLE organism_state (
    ns         TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_ms INTEGER NOT NULL,
    PRIMARY KEY (ns, key)
) WITHOUT ROWID;

CREATE TABLE facts (
    id         INTEGER PRIMARY KEY,
    subject    TEXT NOT NULL,
    predicate  TEXT NOT NULL,
    object     TEXT NOT NULL,
    confidence REAL NOT NULL,
    source     TEXT NOT NULL,
    ts_ms      INTEGER NOT NULL,
    UNIQUE (subject, predicate, object)
);
CREATE INDEX facts_subject ON facts(subject COLLATE NOCASE);

CREATE TABLE vectors (
    doc_id    TEXT PRIMARY KEY,
    text      TEXT NOT NULL,
    dim       INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    ts_ms     INTEGER NOT NULL
);

CREATE TABLE episodes (
    id       INTEGER PRIMARY KEY,
    task_id  TEXT NOT NULL,
    organism TEXT NOT NULL,
    summary  TEXT NOT NULL,
    ts_ms    INTEGER NOT NULL
);
CREATE INDEX episodes_ts ON episodes(ts_ms);
"#];

/// Applies connection pragmas and brings the schema up to date.
pub(crate) fn init(conn: &mut Connection) -> Result<()> {
    conn.busy_timeout(Duration::from_secs(5)).map_err(db_err)?;
    // secure_delete zeroes deleted content so Forget is a real deletion.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA secure_delete = ON;",
    )
    .map_err(db_err)?;
    migrate(conn)
}

fn migrate(conn: &mut Connection) -> Result<()> {
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(db_err)?;
    let latest = MIGRATIONS.len();
    let current = usize::try_from(version).unwrap_or(usize::MAX);
    if current > latest {
        return Err(XzError::Other(format!(
            "engram.db has schema v{version}, newer than this build (v{latest})"
        )));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction().map_err(db_err)?;
        tx.execute_batch(sql).map_err(db_err)?;
        tx.pragma_update(None, "user_version", crate::sql_limit(i + 1))
            .map_err(db_err)?;
        tx.commit().map_err(db_err)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_once_and_rejects_newer_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        init(&mut conn).unwrap();
        // A second init must be a no-op, not a "table exists" error.
        init(&mut conn).unwrap();
        let v: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, MIGRATIONS.len() as i64);

        conn.pragma_update(None, "user_version", 99).unwrap();
        assert!(init(&mut conn).is_err());
    }
}
