use crate::{Verdict, xui};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One step as shown on an action card.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StepRecord {
    pub tool: String,
    pub args: Value,
    pub verdict: Verdict,
    pub ok: bool,
    pub summary: String,
}

/// The result of handling one intent.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Outcome {
    pub task_id: String,
    pub organism: String,
    pub say: Option<String>,
    pub ui: Option<xui::Node>,
    pub steps: Vec<StepRecord>,
    /// Crystal id when the fast path served the intent.
    pub crystal: Option<String>,
    /// False when the step budget ran out before the planner said done.
    pub done: bool,
}
