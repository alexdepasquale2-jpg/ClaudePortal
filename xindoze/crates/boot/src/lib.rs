//! How Xindoze starts with the OS.
//!
//! The Native Edition is Alpine, the `cage` kiosk, and `xinod` as an OpenRC
//! service. Windows Takeover is a named login launcher that leaves Explorer
//! as the shell. Both paths render files into a directory the caller names.
//!
//! `XZ_BOOT_APPLY=1` is required before a real login-integration directory is
//! written. `/boot`, EFI, systemd, and Winlogon are refused even then.
//! Tests pass temporary directories and do not set the flag.

mod error;
mod gate;
mod host;
mod lifecycle;
mod power;
mod render;
mod session;
mod takeover;

pub use error::BootError;
pub use gate::{Auth, PathClass, allow_apply, allow_preview, classify};
pub use host::NativeHost;
pub use lifecycle::{
    BOOT_LINE, BootReport, CANVAS_BUDGET, Daemon, NativePlan, Phase, STAGES, Stage, run_service,
};
pub use power::{HostPower, PowerAction, PowerActuator, PowerOrgan, PowerProbe, RefusePower};
pub use render::{Layout, install_layout, layout_text, render_layout};
pub use session::{CanvasCommand, SessionFace, cage_command};
pub use takeover::{
    ConquestMode, LAUNCHER_NAME, STATE_NAME, TakeoverPlan, TakeoverWrite,
    install as install_takeover, revert as revert_takeover,
};
