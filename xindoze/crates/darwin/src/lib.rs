//! Darwin: evals, evolution, Crystallizer and Crystal VM (SPEC §3.9, §3.10).
//!
//! The fast path is a versioned plan template. QuickJS synthesis
//! (`(slots, tools) => result`) is TODO(phase 3); this crate does not embed
//! a JS runtime. A crystal skips the planner only when the command and its
//! context match. Tool-returned paths are re-derived by re-running the tools.
//!
//! Champion and challenger live in [`promote`]. A challenger replaces the
//! champion only when it passes strictly more evals and is no slower.
//! The Charter, the Warden, and the Prime Genome are never promotable.

mod crystal;
mod promote;

pub use crystal::{
    CRYSTAL_NS, Crystal, Field, MemoryCrystalCache, PatternToken, PlanTemplate, RUNS_TO_PROMOTE,
    StepTemplate, TEMPLATE_VERSION, TemplateValue, TextPart, TextTemplate, diff,
};
pub use promote::{Champion, Reject, Score, promote};
