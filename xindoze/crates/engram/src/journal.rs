//! The Journal: an append-only log of every tool call (SPEC §3.5), and the
//! Hive sync primitives over it (SPEC §3.12).

use crate::{Engram, db_err, sql_limit};
use rusqlite::types::{Type, Value as SqlValue};
use rusqlite::{OptionalExtension, Row, params, params_from_iter};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use xz_types::{JournalEvent, Result, XzError};

/// Columns read by [`event_from_row`], in order.
pub(crate) const EVENT_COLS: &str = "seq, device, origin_seq, ts_ms, organism, task_id, tool, \
     args, risk, verdict, taint, ok, summary, effects, rewound";

const INSERT_EVENT: &str = "INSERT OR IGNORE INTO events (device, origin_seq, ts_ms, organism, \
     task_id, tool, args, risk, verdict, taint, ok, summary, effects, rewound) \
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)";

/// A Journal filter for [`Engram::events`]. Every set field must match.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct EventQuery {
    pub task_id: Option<String>,
    pub organism: Option<String>,
    /// Inclusive lower bound on `ts_ms`.
    pub since_ms: Option<i64>,
    /// Exclusive upper bound on `ts_ms`.
    pub until_ms: Option<i64>,
    /// Exact tool name, e.g. `fs.move`.
    pub tool: Option<String>,
    /// Maximum number of events returned.
    pub limit: usize,
    /// Also return events that were already rewound.
    pub include_rewound: bool,
}

impl Default for EventQuery {
    fn default() -> Self {
        Self {
            task_id: None,
            organism: None,
            since_ms: None,
            until_ms: None,
            tool: None,
            limit: 100,
            include_rewound: false,
        }
    }
}

impl Engram {
    /// Appends a local event and returns its seq. Engram assigns `seq` and
    /// stamps this device's id; the event's own `seq` and `device` are ignored.
    pub fn append(&self, ev: &JournalEvent) -> Result<i64> {
        let row = EncodedEvent::new(ev)?;
        let mut db = self.db();
        let tx = db.transaction().map_err(db_err)?;
        tx.execute(
            INSERT_EVENT,
            params_from_iter(row.values(&self.device_id, None)),
        )
        .map_err(db_err)?;
        let seq = tx.last_insert_rowid();
        // Local events are their own origin, which keeps Hive sync queries uniform.
        tx.execute("UPDATE events SET origin_seq = ?1 WHERE seq = ?1", [seq])
            .map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(seq)
    }

    /// Events matching `q`, newest first (by timestamp, then local seq).
    pub fn events(&self, q: &EventQuery) -> Result<Vec<JournalEvent>> {
        let mut sql = format!("SELECT {EVENT_COLS} FROM events WHERE 1 = 1");
        let mut args: Vec<SqlValue> = Vec::new();
        let mut filter = |clause: &str, v: SqlValue| {
            sql.push_str(clause);
            args.push(v);
        };
        if let Some(t) = &q.task_id {
            filter(" AND task_id = ?", SqlValue::Text(t.clone()));
        }
        if let Some(o) = &q.organism {
            filter(" AND organism = ?", SqlValue::Text(o.clone()));
        }
        if let Some(t) = &q.tool {
            filter(" AND tool = ?", SqlValue::Text(t.clone()));
        }
        if let Some(ms) = q.since_ms {
            filter(" AND ts_ms >= ?", SqlValue::Integer(ms));
        }
        if let Some(ms) = q.until_ms {
            filter(" AND ts_ms < ?", SqlValue::Integer(ms));
        }
        if !q.include_rewound {
            sql.push_str(" AND rewound = 0");
        }
        sql.push_str(" ORDER BY ts_ms DESC, seq DESC LIMIT ?");
        args.push(SqlValue::Integer(sql_limit(q.limit)));
        self.query_events(&sql, params_from_iter(args), false)
    }

    /// The event with local sequence number `seq`, if any.
    pub fn event(&self, seq: i64) -> Result<Option<JournalEvent>> {
        let sql = format!("SELECT {EVENT_COLS} FROM events WHERE seq = ?1");
        self.db()
            .query_row(&sql, [seq], |r| event_from_row(r, false))
            .optional()
            .map_err(db_err)
    }

    /// Marks an event rewound. Returns false if it was missing or already rewound.
    pub fn mark_rewound(&self, seq: i64) -> Result<bool> {
        let n = self
            .db()
            .execute(
                "UPDATE events SET rewound = 1 WHERE seq = ?1 AND rewound = 0",
                [seq],
            )
            .map_err(db_err)?;
        Ok(n > 0)
    }

    /// Events produced by `device` with an origin seq above `after_seq`, oldest
    /// first. Each returned event's `seq` is its origin seq (the sync key), so
    /// a peer can pass the batch straight to [`Engram::merge_remote`].
    pub fn events_since(&self, device: &str, after_seq: i64) -> Result<Vec<JournalEvent>> {
        let sql = format!(
            "SELECT {EVENT_COLS} FROM events WHERE device = ?1 AND origin_seq > ?2 \
             ORDER BY origin_seq"
        );
        self.query_events(&sql, params![device, after_seq], true)
    }

    /// The highest origin seq stored for `device`, or 0. A peer asks for
    /// `events_since(device, last_seq(device))` to catch up.
    pub fn last_seq(&self, device: &str) -> Result<i64> {
        self.db()
            .query_row(
                "SELECT COALESCE(MAX(origin_seq), 0) FROM events WHERE device = ?1",
                [device],
                |r| r.get(0),
            )
            .map_err(db_err)
    }

    /// Stores events from other devices, keyed by `(device, seq)`, and returns
    /// how many were new. Merging the same batch twice changes nothing.
    /// Events claiming this device's id, an empty device or a seq below 1 are
    /// skipped: only this device writes its own history.
    pub fn merge_remote(&self, events: Vec<JournalEvent>) -> Result<usize> {
        let rows = events
            .iter()
            .filter(|e| e.device != self.device_id && !e.device.is_empty() && e.seq > 0)
            .map(|e| Ok((e, EncodedEvent::new(e)?)))
            .collect::<Result<Vec<_>>>()?;
        let mut db = self.db();
        let tx = db.transaction().map_err(db_err)?;
        let mut added = 0;
        for (ev, row) in &rows {
            added += tx
                .execute(
                    INSERT_EVENT,
                    params_from_iter(row.values(&ev.device, Some(ev.seq))),
                )
                .map_err(db_err)?;
        }
        tx.commit().map_err(db_err)?;
        Ok(added)
    }

    /// Runs an event query. `origin` selects which seq the events report.
    pub(crate) fn query_events(
        &self,
        sql: &str,
        args: impl rusqlite::Params,
        origin: bool,
    ) -> Result<Vec<JournalEvent>> {
        let db = self.db();
        let mut stmt = db.prepare(sql).map_err(db_err)?;
        let rows = stmt
            .query_map(args, |r| event_from_row(r, origin))
            .map_err(db_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
    }
}

/// An event's columns serialized for an INSERT.
struct EncodedEvent<'a> {
    ev: &'a JournalEvent,
    args: String,
    risk: String,
    verdict: String,
    taint: String,
    effects: String,
}

impl<'a> EncodedEvent<'a> {
    fn new(ev: &'a JournalEvent) -> Result<Self> {
        Ok(Self {
            ev,
            args: serde_json::to_string(&ev.args)?,
            risk: enum_text(&ev.risk)?,
            verdict: enum_text(&ev.verdict)?,
            taint: serde_json::to_string(&ev.taint)?,
            effects: serde_json::to_string(&ev.effects)?,
        })
    }

    fn values(&self, device: &str, origin_seq: Option<i64>) -> Vec<SqlValue> {
        let ev = self.ev;
        vec![
            SqlValue::Text(device.to_string()),
            match origin_seq {
                Some(n) => SqlValue::Integer(n),
                None => SqlValue::Null,
            },
            SqlValue::Integer(ev.ts_ms),
            SqlValue::Text(ev.organism.clone()),
            SqlValue::Text(ev.task_id.clone()),
            SqlValue::Text(ev.tool.clone()),
            SqlValue::Text(self.args.clone()),
            SqlValue::Text(self.risk.clone()),
            SqlValue::Text(self.verdict.clone()),
            SqlValue::Text(self.taint.clone()),
            SqlValue::Integer(i64::from(ev.ok)),
            SqlValue::Text(ev.summary.clone()),
            SqlValue::Text(self.effects.clone()),
            SqlValue::Integer(i64::from(ev.rewound)),
        ]
    }
}

/// Builds an event from a row selected with [`EVENT_COLS`].
pub(crate) fn event_from_row(r: &Row<'_>, origin: bool) -> rusqlite::Result<JournalEvent> {
    let seq: i64 = if origin { r.get(2)? } else { r.get(0)? };
    Ok(JournalEvent {
        seq,
        device: r.get(1)?,
        ts_ms: r.get(3)?,
        organism: r.get(4)?,
        task_id: r.get(5)?,
        tool: r.get(6)?,
        args: json_col(r, 7)?,
        risk: enum_col(r, 8)?,
        verdict: enum_col(r, 9)?,
        taint: json_col(r, 10)?,
        ok: r.get(11)?,
        summary: r.get(12)?,
        effects: json_col(r, 13)?,
        rewound: r.get(14)?,
    })
}

/// A unit enum variant as its bare serde name (`"act"`, not `"\"act\""`),
/// so the database stays readable.
fn enum_text<T: Serialize>(v: &T) -> Result<String> {
    match serde_json::to_value(v)? {
        Value::String(s) => Ok(s),
        other => Err(XzError::Parse(format!(
            "expected a unit variant, got {other}"
        ))),
    }
}

fn enum_col<T: DeserializeOwned>(r: &Row<'_>, idx: usize) -> rusqlite::Result<T> {
    let s: String = r.get(idx)?;
    serde_json::from_value(Value::String(s))
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(idx, Type::Text, Box::new(e)))
}

pub(crate) fn json_col<T: DeserializeOwned>(r: &Row<'_>, idx: usize) -> rusqlite::Result<T> {
    let s: String = r.get(idx)?;
    serde_json::from_str(&s)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(idx, Type::Text, Box::new(e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Engram;
    use serde_json::json;
    use xz_types::{Effect, Risk, Taint, Verdict};

    fn event(tool: &str, task: &str) -> JournalEvent {
        JournalEvent {
            seq: 99,
            device: "ignored".into(),
            ts_ms: 1_000,
            organism: "prime".into(),
            task_id: task.into(),
            tool: tool.into(),
            args: json!({"path": "/tmp/a"}),
            risk: Risk::Observe,
            verdict: Verdict::Allowed,
            taint: Taint::from_source("file:/tmp/a"),
            ok: true,
            summary: tool.into(),
            effects: vec![Effect::Irreversible {
                note: "none".into(),
            }],
            rewound: false,
        }
    }

    #[test]
    fn append_stamps_device_and_queries_filter() {
        let eg = Engram::open_temp().unwrap();
        let seq = eg.append(&event("fs.list", "t1")).unwrap();
        assert_eq!(seq, 1);
        let got = eg.event(seq).unwrap().unwrap();
        assert_eq!(got.device, "local");
        assert_eq!(got.seq, 1);
        assert_eq!(got.tool, "fs.list");
        assert_eq!(got.taint.sources.iter().next().unwrap(), "file:/tmp/a");
        assert!(
            eg.events(&EventQuery {
                task_id: Some("missing".into()),
                ..EventQuery::default()
            })
            .unwrap()
            .is_empty()
        );
        eg.mark_rewound(seq).unwrap();
        assert!(!eg.mark_rewound(seq).unwrap());
        assert!(eg.events(&EventQuery::default()).unwrap().is_empty());
        assert_eq!(
            eg.events(&EventQuery {
                include_rewound: true,
                ..EventQuery::default()
            })
            .unwrap()
            .len(),
            1
        );
    }

    #[test]
    fn merge_remote_is_idempotent_and_rejects_self() {
        let eg = Engram::open_temp().unwrap();
        let mut remote = event("fs.read", "t");
        remote.device = "phone".into();
        remote.seq = 4;
        remote.ts_ms = 50;
        assert_eq!(eg.merge_remote(vec![remote.clone()]).unwrap(), 1);
        assert_eq!(eg.merge_remote(vec![remote.clone()]).unwrap(), 0);
        let mut mine = event("fs.read", "t");
        mine.device = "local".into();
        mine.seq = 1;
        assert_eq!(eg.merge_remote(vec![mine]).unwrap(), 0);
        assert_eq!(eg.last_seq("phone").unwrap(), 4);
        let since = eg.events_since("phone", 0).unwrap();
        assert_eq!(since.len(), 1);
        assert_eq!(since[0].seq, 4);
        assert!(eg.events_since("phone", 4).unwrap().is_empty());
    }
}
