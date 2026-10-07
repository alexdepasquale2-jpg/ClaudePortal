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
        tx.execute(INSERT_EVENT, row.params(&self.device_id, None))
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
                .execute(INSERT_EVENT, row.params(&ev.device, Some(ev.seq)))
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

    fn params<'b>(
        &'b self,
        device: &'b str,
        origin_seq: Option<i64>,
    ) -> impl rusqlite::Params + 'b {
        let ev = self.ev;
        params![
            device,
            origin_seq,
            ev.ts_ms,
            ev.organism,
            ev.task_id,
            ev.tool,
            self.args,
            self.risk,
            self.verdict,
            self.taint,
            ev.ok,
            ev.summary,
            self.effects,
            ev.rewound,
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
        other => Err(XzError::Parse(format!("expected a unit variant, got {other}"))),
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
