use crate::{Effect, Risk, Taint};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What the Warden decides for one tool call (SPEC §3.4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "decision", rename_all = "lowercase")]
pub enum Decision {
    Allow,
    Ask { reason: String },
    Deny { reason: String },
}

/// What actually happened after the decision and any confirmation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Allowed,
    Confirmed,
    Declined,
    Denied,
}

/// One Journal row: every tool call, allowed or not (SPEC §3.5).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct JournalEvent {
    /// Local sequence number; 0 before insertion.
    #[serde(default)]
    pub seq: i64,
    /// Device that produced the event (Hive sync key with `seq`).
    pub device: String,
    pub ts_ms: i64,
    pub organism: String,
    pub task_id: String,
    pub tool: String,
    pub args: Value,
    pub risk: Risk,
    pub verdict: Verdict,
    #[serde(default)]
    pub taint: Taint,
    pub ok: bool,
    /// Short human-readable result or error.
    pub summary: String,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub rewound: bool,
}
