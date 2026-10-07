//! Core runtime: Synapse, the Prime organism loop, and the offline reflex
//! (SPEC §3.3, §3.8).
//!
//! Every tool call goes Organism → Synapse → Warden → Organ and is journaled.
//! The offline reflex proposes plans when no local model is reachable. It is
//! not inside the Warden.
//!
//! Context Pager, Forge, and routing to other Organisms are TODO(phase 1).

mod reflex;
mod session;
mod synapse;

pub use reflex::{OfflineReflex, looks_safe_to_delete};
pub use session::{Session, SessionConfig, offline_config};
pub use synapse::{ActResult, Synapse};
