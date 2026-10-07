//! Windows Takeover: fullscreen Canvas at login, Explorer left in place.
//!
//! Spec §4 and NOTES: Takeover starts the Canvas at login. It does not replace
//! the Explorer shell, write Winlogon, or hide a Run key. Revert deletes the
//! one launcher this module wrote and the state file next to it.

use crate::error::BootError;
use crate::gate::{self, Auth};
use crate::session::CanvasCommand;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};

pub const LAUNCHER_NAME: &str = "Xindoze Canvas.cmd";
pub const STATE_NAME: &str = "takeover.json";
const MARKER: &str = "Xindoze Takeover";

/// How much of the host the Canvas asks to cover. Only `Takeover` writes a login file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConquestMode {
    Guest,
    Overlay,
    Takeover,
}

impl ConquestMode {
    fn as_str(self) -> &'static str {
        match self {
            ConquestMode::Guest => "guest",
            ConquestMode::Overlay => "overlay",
            ConquestMode::Takeover => "takeover",
        }
    }
}

/// The login plan. `explorer_remains_shell` is always true.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TakeoverPlan {
    pub mode: ConquestMode,
    pub explorer_remains_shell: bool,
    pub fullscreen: bool,
    pub writes_registry: bool,
    pub reversible: bool,
}

impl TakeoverPlan {
    pub fn new(mode: ConquestMode) -> Result<Self, BootError> {
        if matches!(mode, ConquestMode::Takeover) {
            Ok(Self {
                mode,
                explorer_remains_shell: true,
                fullscreen: true,
                writes_registry: false,
                reversible: true,
            })
        } else {
            Ok(Self {
                mode,
                explorer_remains_shell: true,
                fullscreen: false,
                writes_registry: false,
                reversible: true,
            })
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TakeoverWrite {
    pub state: PathBuf,
    pub launcher: Option<PathBuf>,
}

/// Write state, and for Takeover the named Startup launcher, into caller-supplied dirs.
pub fn install(
    data_dir: &Path,
    startup_dir: &Path,
    plan: &TakeoverPlan,
    auth: Auth,
) -> Result<TakeoverWrite, BootError> {
    if !plan.explorer_remains_shell || plan.writes_registry || !plan.reversible {
        return Err(BootError::Refused(
            "takeover must keep Explorer, skip the registry, and stay reversible".into(),
        ));
    }
    gate::allow_apply(data_dir, auth)?;
    gate::allow_apply(startup_dir, auth)?;
    fs::create_dir_all(data_dir)?;
    fs::create_dir_all(startup_dir)?;

    let launcher = if plan.mode == ConquestMode::Takeover {
        if !plan.fullscreen {
            return Err(BootError::Refused(
                "takeover starts the canvas fullscreen".into(),
            ));
        }
        let path = startup_dir.join(LAUNCHER_NAME);
        fs::write(&path, launcher_script())?;
        Some(path)
    } else {
        None
    };

    let state_path = data_dir.join(STATE_NAME);
    let state = json!({
        "mode": plan.mode.as_str(),
        "explorer_remains_shell": true,
        "shell": "explorer.exe",
        "fullscreen": plan.fullscreen,
        "launcher": launcher.as_ref().map(|_| LAUNCHER_NAME),
        "reversible": true,
        "writes_registry": false,
        "replaces_shell": false,
    });
    fs::write(
        &state_path,
        format!("{}\n", serde_json::to_string_pretty(&state).unwrap()),
    )?;
    let written = fs::read_to_string(&state_path)?;
    ensure_clean(&written)?;
    if let Some(path) = &launcher {
        ensure_clean(&fs::read_to_string(path)?)?;
    }
    Ok(TakeoverWrite {
        state: state_path,
        launcher,
    })
}

fn launcher_script() -> String {
    format!(
        "@echo off\r\nREM {MARKER}. Starts the Canvas fullscreen at login.\r\nREM Explorer stays the Windows shell. This file does not change the shell setting.\r\nREM Revert: delete this file and {STATE_NAME}.\r\nstart \"\" \"{program}\" --fullscreen\r\n",
        program = CanvasCommand::WINDOWS_PROGRAM,
    )
}

fn ensure_clean(text: &str) -> Result<(), BootError> {
    let lower = text.to_ascii_lowercase();
    for banned in [
        "winlogon",
        "reg add",
        "reg.exe",
        "hklm",
        "hkcu",
        "userinit",
        "appinit_dlls",
        "image file execution options",
        "runonce",
        "bcdedit",
        "grub-install",
    ] {
        if lower.contains(banned) {
            return Err(BootError::Refused(format!(
                "takeover output contains {banned}"
            )));
        }
    }
    Ok(())
}

/// Delete only the launcher and state file this module owns.
///
/// Works without `XZ_BOOT_APPLY` so Takeover can always be turned off.
/// A launcher that lacks the marker is left alone.
pub fn revert(data_dir: &Path, startup_dir: &Path) -> Result<Vec<PathBuf>, BootError> {
    if matches!(gate::classify(data_dir), gate::PathClass::Forbidden)
        || matches!(gate::classify(startup_dir), gate::PathClass::Forbidden)
    {
        return Err(BootError::HostBootPath(format!(
            "{} and {}",
            data_dir.display(),
            startup_dir.display()
        )));
    }
    let mut removed = Vec::new();
    let launcher = startup_dir.join(LAUNCHER_NAME);
    if launcher.is_file() {
        let body = fs::read_to_string(&launcher)?;
        if !body.contains(MARKER) {
            return Err(BootError::Refused(format!(
                "{} is not an Xindoze launcher",
                launcher.display()
            )));
        }
        fs::remove_file(&launcher)?;
        removed.push(launcher);
    }
    let state = data_dir.join(STATE_NAME);
    if state.is_file() {
        let parsed: Value = serde_json::from_str(&fs::read_to_string(&state)?)
            .map_err(|err| BootError::Refused(format!("takeover state is not ours: {err}")))?;
        if parsed.get("replaces_shell") != Some(&Value::Bool(false)) {
            return Err(BootError::Refused(
                "refusing to remove a state file this module did not write".into(),
            ));
        }
        fs::remove_file(&state)?;
        removed.push(state);
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takeover_is_a_named_launcher_and_revert_is_exact() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        let startup = root.path().join("startup");
        fs::create_dir_all(&startup).unwrap();
        fs::write(startup.join("keep.txt"), "leave me").unwrap();

        let plan = TakeoverPlan::new(ConquestMode::Takeover).unwrap();
        assert!(plan.explorer_remains_shell);
        assert!(!plan.writes_registry);
        let wrote = install(&data, &startup, &plan, Auth::Explicit).unwrap();
        let cmd = fs::read_to_string(wrote.launcher.unwrap()).unwrap();
        assert!(cmd.contains("--fullscreen"));
        assert!(cmd.contains(MARKER));
        assert!(cmd.contains("Explorer stays"));
        let state: Value =
            serde_json::from_str(&fs::read_to_string(&data.join(STATE_NAME)).unwrap()).unwrap();
        assert_eq!(state["shell"], "explorer.exe");
        assert_eq!(state["replaces_shell"], false);
        assert_eq!(state["writes_registry"], false);

        let removed = revert(&data, &startup).unwrap();
        assert_eq!(removed.len(), 2);
        assert!(!data.join(STATE_NAME).exists());
        assert!(!startup.join(LAUNCHER_NAME).exists());
        assert_eq!(
            fs::read_to_string(startup.join("keep.txt")).unwrap(),
            "leave me"
        );
    }

    #[test]
    fn guest_and_overlay_do_not_write_a_login_file() {
        let root = tempfile::tempdir().unwrap();
        for mode in [ConquestMode::Guest, ConquestMode::Overlay] {
            let data = root.path().join(mode.as_str());
            let startup = data.join("startup");
            let plan = TakeoverPlan::new(mode).unwrap();
            let wrote = install(&data, &startup, &plan, Auth::Explicit).unwrap();
            assert!(wrote.launcher.is_none());
            assert!(!startup.join(LAUNCHER_NAME).exists());
        }
    }

    #[test]
    fn apply_flag_and_host_paths() {
        let root = tempfile::tempdir().unwrap();
        let plan = TakeoverPlan::new(ConquestMode::Takeover).unwrap();
        assert!(install(root.path(), root.path(), &plan, Auth::Denied).is_err());
        assert!(install(Path::new("/boot"), root.path(), &plan, Auth::Explicit).is_err());
        assert!(revert(Path::new("/boot"), root.path()).is_err());
        assert!(!Path::new("/boot/Xindoze Canvas.cmd").exists());
    }

    #[test]
    fn revert_leaves_a_foreign_file() {
        let root = tempfile::tempdir().unwrap();
        let startup = root.path().join("startup");
        fs::create_dir_all(&startup).unwrap();
        fs::write(startup.join(LAUNCHER_NAME), "@echo off\r\nREM not ours\r\n").unwrap();
        let err = revert(root.path(), &startup).unwrap_err();
        assert!(err.to_string().contains("not an Xindoze launcher"));
        assert!(startup.join(LAUNCHER_NAME).exists());
    }

    #[test]
    fn unsafe_plan_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let mut plan = TakeoverPlan::new(ConquestMode::Takeover).unwrap();
        plan.explorer_remains_shell = false;
        assert!(install(root.path(), root.path(), &plan, Auth::Explicit).is_err());
        plan = TakeoverPlan::new(ConquestMode::Takeover).unwrap();
        plan.writes_registry = true;
        assert!(install(root.path(), root.path(), &plan, Auth::Explicit).is_err());
    }
}
