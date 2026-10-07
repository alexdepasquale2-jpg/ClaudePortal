//! Render the Native Edition's service files into a staging directory.
//!
//! The files describe Alpine + OpenRC + `cage`. They are not copied onto the
//! host init system by [`render_layout`].

use crate::error::BootError;
use crate::gate::{self, Auth};
use crate::lifecycle::{BOOT_LINE, BootReport, Daemon, NativePlan};
use crate::session::{CanvasCommand, SessionFace, cage_command};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

/// Files written for one image layout.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Layout {
    pub root: PathBuf,
    pub report: BootReport,
    pub files: Vec<PathBuf>,
}

/// Write a native rootfs tree. `dest` must be a staging directory.
pub fn render_layout(dest: &Path, plan: &NativePlan) -> Result<Layout, BootError> {
    gate::allow_preview(dest)?;
    write_layout(dest, plan)
}

/// Same tree, but the caller has passed [`Auth::Explicit`].
///
/// Firmware paths still fail. A host `/etc/init.d` is accepted only here.
pub fn install_layout(dest: &Path, plan: &NativePlan, auth: Auth) -> Result<Layout, BootError> {
    gate::allow_apply(dest, auth)?;
    write_layout(dest, plan)
}

fn write_layout(dest: &Path, plan: &NativePlan) -> Result<Layout, BootError> {
    let mut daemon = Daemon::new();
    let report = daemon.boot(plan)?;
    fs::create_dir_all(dest)?;

    let canvas = CanvasCommand::native();
    let session_script = format!(
        "#!/bin/sh\n# Native session: cage is the only compositor. The Canvas is fullscreen.\n{}\n",
        cage_command(&canvas)
    );
    let xinod = format!(
        r#"#!/sbin/openrc-run
# Xindoze native service. This file belongs inside the image layout.
name="xinod"
description="Xindoze daemon"
command="/usr/bin/xinod"
command_args="--service"
command_background=true
pidfile="/run/xinod.pid"
supervisor=supervise-daemon

depend() {{
	need localmount
	after bootmisc
}}
"#
    );
    let session_unit = r#"#!/sbin/openrc-run
name="xindoze-session"
description="cage kiosk and the Canvas"
command="/usr/libexec/xindoze-session"
command_background=true
pidfile="/run/xindoze-session.pid"
supervisor=supervise-daemon

depend() {
	need xinod
	after xinod
}
"#;
    let boot_json = json!({
        "edition": plan.edition,
        "arch": plan.arch,
        "base": plan.base,
        "compositor": plan.compositor,
        "service": "xinod",
        "boot_line": BOOT_LINE,
        "budget_secs": plan.budget.as_secs(),
        "canvas": canvas.program(),
        "canvas_args": canvas.args(),
        "hive": false,
        "ancestor_terminal": false,
        "replaces_explorer": false,
        "encryption": "luks-from-host",
        "kernel": "host-linux",
    });
    let ancestor = json!({
        "enabled": false,
        "runlevel": null,
        "requires_charter": "ancestor.terminal",
        "command": "/bin/busybox",
        "args": ["sh"],
        "note": "Not started at boot. The Charter must grant ancestor.terminal first.",
    });

    let files = vec![
        write_executable(dest, "usr/libexec/xindoze-session", &session_script)?,
        write_executable(dest, "etc/init.d/xinod", &xinod)?,
        write_executable(dest, "etc/init.d/xindoze-session", session_unit)?,
        write_text(
            dest,
            "etc/xindoze/boot.json",
            &format!("{}\n", serde_json::to_string_pretty(&boot_json).unwrap()),
        )?,
        write_text(
            dest,
            "etc/xindoze/ancestor-terminal.json",
            &format!("{}\n", serde_json::to_string_pretty(&ancestor).unwrap()),
        )?,
        link_runlevel(dest, "xinod")?,
        link_runlevel(dest, "xindoze-session")?,
    ];

    let ancestor_link = dest.join("etc/runlevels/default/xindoze-ancestor");
    if ancestor_link.exists() {
        return Err(BootError::Refused(
            "ancestor terminal must not be in the default runlevel".into(),
        ));
    }

    Ok(Layout {
        root: dest.to_path_buf(),
        report,
        files,
    })
}

fn write_text(root: &Path, rel: &str, body: &str) -> Result<PathBuf, BootError> {
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, body)?;
    Ok(path)
}

fn write_executable(root: &Path, rel: &str, body: &str) -> Result<PathBuf, BootError> {
    let path = write_text(root, rel, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&path, perms)?;
    }
    Ok(path)
}

fn link_runlevel(root: &Path, name: &str) -> Result<PathBuf, BootError> {
    let dir = root.join("etc/runlevels/default");
    fs::create_dir_all(&dir)?;
    let path = dir.join(name);
    let target = format!("/etc/init.d/{name}");
    #[cfg(unix)]
    {
        if path.exists() {
            fs::remove_file(&path)?;
        }
        std::os::unix::fs::symlink(&target, &path)?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&path, format!("symlink {target}\n"))?;
    }
    Ok(path)
}

/// Strings that must not appear in a native layout.
pub fn layout_text(layout: &Layout) -> Result<String, BootError> {
    let mut all = String::new();
    for path in &layout.files {
        if path.is_file() {
            all.push_str(&fs::read_to_string(path)?);
            all.push('\n');
        }
    }
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gate::Auth;

    #[test]
    fn layout_has_service_and_no_ancestor_runlevel() {
        let dir = tempfile::tempdir().unwrap();
        let plan = NativePlan::alpine("x86_64").unwrap();
        let layout = render_layout(dir.path(), &plan).unwrap();
        assert_eq!(layout.report.line, BOOT_LINE);
        let text = layout_text(&layout).unwrap();
        assert!(text.contains("Xindoze has evolved."));
        assert!(text.contains("command_args=\"--service\""));
        assert!(text.contains("exec cage -- '/usr/bin/xindoze-canvas' '--fullscreen'"));
        assert!(text.contains("ancestor.terminal"));
        for banned in [
            "grub-install",
            "efibootmgr",
            "Winlogon",
            "cryptsetup",
            "reg add",
            "bcdedit",
        ] {
            assert!(!text.contains(banned), "{banned}");
        }
        assert!(
            dir.path()
                .join("etc/runlevels/default/xinod")
                .symlink_metadata()
                .is_ok()
        );
        assert!(
            dir.path()
                .join("etc/runlevels/default/xindoze-session")
                .symlink_metadata()
                .is_ok()
        );
        assert!(
            dir.path()
                .join("etc/runlevels/default/xindoze-ancestor")
                .symlink_metadata()
                .is_err()
        );
        assert!(!Path::new("/etc/init.d/xinod").exists());
        assert!(!Path::new("/boot/xindoze").exists());
    }

    #[test]
    fn preview_refuses_host_boot_and_apply_needs_the_flag() {
        let plan = NativePlan::alpine("aarch64").unwrap();
        assert!(render_layout(Path::new("/boot/xindoze"), &plan).is_err());
        assert!(render_layout(Path::new("/etc/init.d"), &plan).is_err());
        let dir = tempfile::tempdir().unwrap();
        assert!(install_layout(dir.path(), &plan, Auth::Denied).is_err());
        assert!(dir.path().read_dir().unwrap().next().is_none());
        let layout = install_layout(dir.path(), &plan, Auth::Explicit).unwrap();
        assert_eq!(layout.report.line, BOOT_LINE);
    }
}
