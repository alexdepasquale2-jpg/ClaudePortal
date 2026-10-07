use crate::{ToolCall, ToolOutput, XzError, xui};
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
}

/// The crystal fast path, implemented by `xz_darwin`.
#[async_trait]
pub trait CrystalCache: Send + Sync {
    /// Serve the intent from a crystal. `None` means a miss, so take the fluid path.
    /// `Some(Err(_))` means the crystal failed; the caller falls back to fluid.
    async fn try_run(
        &self,
        organism: &str,
        intent: &str,
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
