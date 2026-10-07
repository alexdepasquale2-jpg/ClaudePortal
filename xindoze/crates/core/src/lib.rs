//! Core runtime: Synapse, the Organism loop, routing and the Context Pager
//! (SPEC §3.3, §3.7, §3.8).
//!
//! Models propose plans. The Warden and the Journal decide what happens.
//! The offline reflex is a stand-in planner for machines with no model
//! weights; it is not part of the Warden.

mod organs;
mod pager;
mod reflex;
mod route;
mod session;
mod synapse;

pub use organs::Desk;
pub use pager::{Page, page};
pub use reflex::{OfflineReflex, looks_safe_to_delete};
pub use route::route;
pub use session::{Session, SessionConfig};
pub use synapse::{ActResult, Synapse};
