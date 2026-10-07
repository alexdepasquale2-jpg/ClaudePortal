//! Universal Bridge: host capabilities and the Phase 0 Organs (SPEC §3.1, §3.2).
//!
//! `fs`, `proc`, and `net.fetch` run in-process and still go through the
//! Synapse. Platform bridges beyond this host are TODO(phase 1) for Windows
//! UI Automation and TODO(phase 2) for the Android Kotlin plugin.

mod fs;
mod host;
mod net;
mod proc;

pub use fs::FsOrgan;
pub use host::{Host, ThisHost};
pub use net::NetOrgan;
pub use proc::ProcOrgan;
