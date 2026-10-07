//! Helpers shared by the unit tests.

use serde_json::json;
use xz_types::{Effect, JournalEvent, Risk, Taint, Verdict};

/// A successful `act` event with the given effects.
pub(crate) fn event(task_id: &str, tool: &str, effects: Vec<Effect>) -> JournalEvent {
    JournalEvent {
        seq: 0,
        device: String::new(),
        ts_ms: xz_types::now_ms(),
        organism: "test".into(),
        task_id: task_id.into(),
        tool: tool.into(),
        args: json!({}),
        risk: Risk::Act,
        verdict: Verdict::Allowed,
        taint: Taint::none(),
        ok: true,
        summary: format!("{tool} ok"),
        effects,
        rewound: false,
    }
}
