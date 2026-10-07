//! Shared contracts for every Xindoze crate (SPEC.md §3).
//!
//! This crate holds only types and traits that cross crate boundaries.
//! It stays dependency-light so every other crate can build against it.

pub mod confirm;
pub mod crystal;
pub mod error;
pub mod journal;
pub mod model;
pub mod outcome;
pub mod path;
pub mod plan;
pub mod taint;
pub mod tool;
pub mod xui;

pub use confirm::{AlwaysNo, AlwaysYes, AskInfo, Confirmer};
pub use crystal::{CrystalCache, CrystalRun, ToolInvoker, Trace, TraceStep};
pub use error::XzError;
pub use journal::{Decision, JournalEvent, Verdict};
pub use model::{
    ChatMessage, GenRequest, GenResponse, Inference, ModelBackend, MsgRole, Priority, Role,
};
pub use outcome::{Outcome, StepRecord};
pub use plan::{Plan, Step};
pub use taint::Taint;
pub use tool::{
    CallCtx, Effect, Grant, NoSnapshot, Organ, Risk, Snapshotter, ToolCall, ToolOutput, ToolSpec,
};

pub type Result<T, E = XzError> = std::result::Result<T, E>;

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
