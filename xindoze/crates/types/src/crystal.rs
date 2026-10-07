use crate::{Grant, Taint, ToolCall, ToolOutput, XzError, xui};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Calls a tool on behalf of an Organism, through the Synapse and Warden.
#[async_trait]
pub trait ToolInvoker: Send + Sync {
    async fn invoke(&self, call: ToolCall) -> Result<ToolOutput, XzError>;
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TraceStep {
    pub call: ToolCall,
    pub ok: bool,
    pub output: Value,
}

/// A finished fluid run, kept for crystallization and evolution (SPEC §3.9-3.10).
///
/// `charter_generation`, `grants` and `taint` are part of the crystal key.
/// Tool outputs are not: a later run re-derives those by calling the tools.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Trace {
    pub organism: String,
    pub intent: String,
    pub steps: Vec<TraceStep>,
    pub ok: bool,
    #[serde(default)]
    pub say: Option<String>,
    #[serde(default)]
    pub ui: Option<xui::Node>,
    /// Hash of the Charter in force when the plan was chosen.
    #[serde(default)]
    pub charter_generation: String,
    /// Capabilities the organism held.
    #[serde(default)]
    pub grants: Vec<Grant>,
    /// Taint of the inputs the plan was chosen under. Not tool-output taint.
    #[serde(default)]
    pub taint: Taint,
}

/// What the caller already knows when it asks a crystal to run.
///
/// A hit requires the same organism, charter generation, grants, taint and
/// wording, and every plan-choosing anchor stored on the crystal.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrystalQuery {
    pub organism: String,
    pub intent: String,
    pub charter_generation: String,
    pub grants: Vec<Grant>,
    pub taint: Taint,
    /// Ambient plan-choosing values (search root, destination, recipient, account).
    pub anchors: Vec<ContextAnchor>,
}

/// A plan-choosing value that was not typed in the command and did not come
/// back from a tool.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ContextAnchor {
    /// `root`, `destination`, `recipient` or `account`.
    pub field: String,
    pub value: String,
}

/// The crystal fast path, implemented by `xz_darwin`.
#[async_trait]
pub trait CrystalCache: Send + Sync {
    /// Serve the intent from a crystal. `None` means a miss, so take the fluid path.
    /// `Some(Err(_))` means the crystal failed; the caller falls back to fluid.
    ///
    /// The wording alone is not enough. Organism, charter generation, grants,
    /// taint and plan-choosing anchors have to match too.
    async fn try_run(
        &self,
        query: &CrystalQuery,
        tools: &dyn ToolInvoker,
    ) -> Option<Result<CrystalRun, XzError>>;

    /// Record a finished fluid run for future crystallization.
    async fn observe(&self, trace: &Trace);
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CrystalRun {
    pub crystal_id: String,
    pub say: Option<String>,
    pub ui: Option<xui::Node>,
    pub steps: Vec<TraceStep>,
}
