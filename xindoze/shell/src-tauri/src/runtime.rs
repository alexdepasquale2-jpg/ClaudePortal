//! The seam between the Canvas and the Xindoze runtime.
//!
//! Every Tauri command goes through [`ShellRuntime`]. The desktop shell
//! implements it with [`crate::core_runtime::CoreRuntime`] over `xinod`'s session.

pub const EVENT_ASK: &str = "xz://ask";
pub const EVENT_STEP: &str = "xz://step";

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::broadcast;
use xz_types::{JournalEvent, Outcome, Role, StepRecord, XzError};

/// What the Canvas needs from the runtime. Shapes mirror `shell/ui/src/lib/api.ts`.
#[async_trait]
pub trait ShellRuntime: Send + Sync {
    /// Handle an intent typed or spoken into the Intent Bar (Prime routes it).
    async fn intent(&self, text: &str) -> Result<Outcome, XzError>;
    /// Handle an intent addressed to one Organism (its Canvas pane).
    async fn intent_for(&self, organism: &str, text: &str) -> Result<Outcome, XzError>;
    /// A button bound to a tool call; still goes through the Warden.
    async fn tool_call(&self, organism: &str, tool: &str, args: Value)
    -> Result<ToolReply, XzError>;
    /// Undo every reversible effect of a task.
    async fn rewind(&self, task_id: &str) -> Result<RewindReport, XzError>;
    async fn pulse(&self) -> Result<Pulse, XzError>;
    async fn genomes(&self) -> Result<Vec<GenomeInfo>, XzError>;
    /// Newest events first.
    async fn journal(&self, limit: usize) -> Result<Vec<JournalEvent>, XzError>;
    async fn charter(&self) -> Result<CharterView, XzError>;
    /// Answer an `xz://ask` card.
    async fn confirm_reply(&self, id: &str, approve: bool) -> Result<(), XzError>;
    /// Resolve a local blob ref to a `data:image/...` URL, or an empty string.
    async fn blob(&self, reference: &str) -> Result<String, XzError>;
    /// Steps as they happen, forwarded to the UI as `xz://step`.
    fn subscribe_steps(&self) -> broadcast::Receiver<StepEvent>;
}

/// Payload of the `xz://step` event.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StepEvent {
    pub task_id: String,
    pub step: StepRecord,
}

/// Result of a UI-bound tool call.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolReply {
    pub content: Value,
}

/// What Rewind did, one human-readable line per effect.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RewindReport {
    pub undone: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<String>,
}

/// System health for the Pulse surface (SPEC 3.11).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Pulse {
    pub host: String,
    pub tier: String,
    pub models: Vec<ModelStatus>,
    pub tokens_per_sec: f64,
    pub requests: u64,
    pub peers: Vec<PeerStatus>,
    /// Recent egress attempts; the zero-egress indicator reads this.
    pub egress: Vec<EgressEvent>,
    pub journal_count: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ModelStatus {
    pub role: Role,
    pub model: String,
    pub backend: String,
    pub loaded: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PeerStatus {
    pub name: String,
    pub online: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EgressEvent {
    pub host: String,
    pub ts_ms: i64,
    pub allowed: bool,
}

/// An installed Genome as listed in the Canvas.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GenomeInfo {
    pub id: String,
    pub version: String,
    pub purpose: String,
    /// `canvas` or `none`.
    pub ui: String,
}

/// The Charter as plain-language rules.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CharterView {
    pub rules: Vec<CharterRule>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CharterRule {
    pub id: String,
    pub text: String,
    pub decision: RuleDecision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleDecision {
    Allow,
    Ask,
    Deny,
}

/// Guest / Overlay / Takeover as the Canvas switch reads it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConquestView {
    /// False on Android, where HOME-launcher Takeover belongs to that track.
    pub supported: bool,
    pub mode: String,
    /// How to leave Takeover without the Canvas (hotkey and command).
    pub undo: String,
}
