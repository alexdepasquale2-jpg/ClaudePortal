//! Universal Bridge: host capabilities and core Organs (SPEC §3.1, §3.2).
//!
//! A [`Host`] tells Xindoze which capability families this device supports
//! and hands out the in-process core Organs that serve them: `fs`, `proc`,
//! `net`, `clip`, `notify` and `sys` (SPEC Appendix D). Third-party MCP
//! servers mount through [`mcp_mount`], and legacy command-line programs
//! become tools through [`ancestors_cli`].
//!
//! Every path argument is resolved with [`xz_types::path::resolve`], the same
//! function the Warden uses, so a permission check and the Organ always talk
//! about the same file. Because the Warden checks paths lexically, the
//! Organs refuse to follow symbolic links (see `paths.rs`).

pub mod ancestors_cli;
pub mod clip;
mod content;
pub mod fs;
pub mod host;
pub mod mcp_mount;
pub mod net;
pub mod notify;
mod paths;
pub mod proc;
mod spawn;
pub mod sys;
#[cfg(test)]
mod testutil;
mod util;

pub use ancestors_cli::{Ancestor, AncestorOrgan};
pub use clip::ClipOrgan;
pub use fs::FsOrgan;
#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
pub use host::DesktopHost;
pub use host::{CapabilityManifest, FAMILIES, GenericHost, Host, Support};
pub use mcp_mount::McpMount;
pub use net::NetOrgan;
pub use notify::NotifyOrgan;
pub use proc::ProcOrgan;
pub use sys::SysOrgan;
