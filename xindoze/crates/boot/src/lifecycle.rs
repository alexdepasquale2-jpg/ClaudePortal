//! In-process service lifecycle for `xinod`.
//!
//! Booting this state machine does not install a bootloader, write a unit
//! on the host, or start a compositor. It only records the order a Native
//! Edition start is allowed to take.

use crate::error::BootError;
use std::time::Duration;

/// What the daemon is doing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Stopped,
    Starting,
    Ready,
    Stopping,
    Failed,
}

/// Ordered steps of a native start. The kernel and LUKS stay outside this list:
/// Alpine's kernel and the disk unlock are the substrate, not Xindoze.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    /// The host kernel is already running. Xindoze does not install one.
    Substrate,
    /// Data directory. Encryption at rest is the host's LUKS, not a command we run.
    Data,
    /// `xinod` as an OpenRC service.
    Service,
    /// `bridge-native` capabilities for this process.
    Bridge,
    /// `cage` with the Canvas fullscreen.
    Session,
    /// Busybox stays installed and stays out of the default runlevel.
    AncestorGate,
}

/// Spec §4: the Canvas is up within this long on bare metal.
pub const CANVAS_BUDGET: Duration = Duration::from_secs(20);

/// Spec §14.
pub const BOOT_LINE: &str = "Xindoze has evolved.";

/// The only order a native start may use.
pub const STAGES: &[Stage] = &[
    Stage::Substrate,
    Stage::Data,
    Stage::Service,
    Stage::Bridge,
    Stage::Session,
    Stage::AncestorGate,
];

/// What a start is allowed to claim. The defaults refuse Explorer replacement,
/// an ancestor shell at boot, and Hive dialing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativePlan {
    pub arch: String,
    pub edition: &'static str,
    pub base: &'static str,
    pub compositor: &'static str,
    pub budget: Duration,
    pub replaces_explorer: bool,
    pub ancestor_at_boot: bool,
    pub hive: bool,
}

impl NativePlan {
    /// Alpine image plan for `x86_64` or `aarch64`.
    pub fn alpine(arch: &str) -> Result<Self, BootError> {
        if arch != "x86_64" && arch != "aarch64" {
            return Err(BootError::Refused(
                "native arch is x86_64 or aarch64".into(),
            ));
        }
        Ok(Self {
            arch: arch.into(),
            edition: "native",
            base: "alpine",
            compositor: "cage",
            budget: CANVAS_BUDGET,
            replaces_explorer: false,
            ancestor_at_boot: false,
            hive: false,
        })
    }
}

/// Result of a successful in-process start.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BootReport {
    pub line: &'static str,
    pub phase: Phase,
    pub stages: &'static [Stage],
    pub within_budget: bool,
}

/// The `xinod` service state machine.
#[derive(Debug)]
pub struct Daemon {
    phase: Phase,
}

impl Default for Daemon {
    fn default() -> Self {
        Self::new()
    }
}

impl Daemon {
    pub fn new() -> Self {
        Self {
            phase: Phase::Stopped,
        }
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// Move `Stopped` or `Failed` to `Ready`. Writes nothing.
    pub fn boot(&mut self, plan: &NativePlan) -> Result<BootReport, BootError> {
        match self.phase {
            Phase::Stopped | Phase::Failed => {}
            _ => {
                return Err(BootError::BadState("boot requires stopped"));
            }
        }
        self.phase = Phase::Starting;
        if let Err(err) = check_plan(plan) {
            self.phase = Phase::Failed;
            return Err(err);
        }
        self.phase = Phase::Ready;
        Ok(BootReport {
            line: BOOT_LINE,
            phase: Phase::Ready,
            stages: STAGES,
            within_budget: plan.budget <= CANVAS_BUDGET,
        })
    }

    /// Move `Ready` back to `Stopped`.
    pub fn stop(&mut self) -> Result<(), BootError> {
        if self.phase != Phase::Ready {
            return Err(BootError::BadState("stop requires ready"));
        }
        self.phase = Phase::Stopping;
        self.phase = Phase::Stopped;
        Ok(())
    }
}

fn check_plan(plan: &NativePlan) -> Result<(), BootError> {
    if plan.replaces_explorer {
        return Err(BootError::Refused(
            "a boot plan must not replace Explorer".into(),
        ));
    }
    if plan.compositor != "cage" {
        return Err(BootError::Refused(
            "the native session compositor is cage".into(),
        ));
    }
    if plan.base != "alpine" {
        return Err(BootError::Refused("the native base is alpine".into()));
    }
    if plan.budget > CANVAS_BUDGET {
        return Err(BootError::Refused(
            "the canvas boot budget is 20 seconds".into(),
        ));
    }
    if plan.ancestor_at_boot {
        return Err(BootError::Refused(
            "the ancestor terminal stays behind the Charter and out of the default runlevel".into(),
        ));
    }
    if plan.hive {
        return Err(BootError::Refused(
            "hive pairing is a different track and does not run at boot".into(),
        ));
    }
    Ok(())
}

/// Park a started daemon until the process is signalled.
///
/// This does not open a session, create a data directory, or install units.
pub async fn run_service(arch: &str) -> Result<BootReport, BootError> {
    let plan = NativePlan::alpine(arch)?;
    let mut daemon = Daemon::new();
    let report = daemon.boot(&plan)?;
    println!("{}", report.line);
    println!("xinod service ready");
    let _ = std::io::Write::flush(&mut std::io::stdout());
    let _ = tokio::signal::ctrl_c().await;
    daemon.stop()?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_then_stop() {
        let plan = NativePlan::alpine("x86_64").unwrap();
        let mut daemon = Daemon::new();
        let report = daemon.boot(&plan).unwrap();
        assert_eq!(report.line, "Xindoze has evolved.");
        assert_eq!(report.phase, Phase::Ready);
        assert!(report.within_budget);
        assert_eq!(
            report.stages,
            &[
                Stage::Substrate,
                Stage::Data,
                Stage::Service,
                Stage::Bridge,
                Stage::Session,
                Stage::AncestorGate,
            ]
        );
        assert_eq!(daemon.phase(), Phase::Ready);
        daemon.stop().unwrap();
        assert_eq!(daemon.phase(), Phase::Stopped);
        daemon.boot(&plan).unwrap();
    }

    #[test]
    fn aarch64_plan_boots() {
        let plan = NativePlan::alpine("aarch64").unwrap();
        assert_eq!(plan.arch, "aarch64");
        Daemon::new().boot(&plan).unwrap();
    }

    #[test]
    fn rejects_unknown_arch_and_unsafe_plans() {
        assert!(NativePlan::alpine("i686").is_err());
        let mut bad = NativePlan::alpine("x86_64").unwrap();
        bad.replaces_explorer = true;
        let mut daemon = Daemon::new();
        assert!(daemon.boot(&bad).is_err());
        assert_eq!(daemon.phase(), Phase::Failed);

        bad = NativePlan::alpine("x86_64").unwrap();
        bad.ancestor_at_boot = true;
        assert!(Daemon::new().boot(&bad).is_err());

        bad = NativePlan::alpine("x86_64").unwrap();
        bad.hive = true;
        assert!(Daemon::new().boot(&bad).is_err());

        bad = NativePlan::alpine("x86_64").unwrap();
        bad.budget = Duration::from_secs(21);
        assert!(Daemon::new().boot(&bad).is_err());

        bad = NativePlan::alpine("x86_64").unwrap();
        bad.compositor = "weston";
        assert!(Daemon::new().boot(&bad).is_err());
    }

    #[test]
    fn double_boot_and_idle_stop_fail() {
        let plan = NativePlan::alpine("x86_64").unwrap();
        let mut daemon = Daemon::new();
        daemon.boot(&plan).unwrap();
        assert!(daemon.boot(&plan).is_err());
        assert_eq!(daemon.phase(), Phase::Ready);
        daemon.stop().unwrap();
        assert!(daemon.stop().is_err());
    }

    #[test]
    fn boot_does_not_touch_host_paths() {
        let before = std::fs::metadata("/boot")
            .ok()
            .and_then(|m| m.modified().ok());
        let plan = NativePlan::alpine("x86_64").unwrap();
        Daemon::new().boot(&plan).unwrap();
        assert!(!std::path::Path::new("/etc/init.d/xinod").exists());
        assert!(!std::path::Path::new("/boot/xindoze").exists());
        let after = std::fs::metadata("/boot")
            .ok()
            .and_then(|m| m.modified().ok());
        assert_eq!(before, after);
    }
}
