//! The image scripts must refuse to run unless asked, and must not touch host boot.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn script(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../native/{name}"))
}

fn boot_bin() -> PathBuf {
    let mut path = std::env::current_exe().unwrap();
    path.pop();
    path.pop();
    path.push("xz-boot");
    path
}

fn boot_mtime() -> Option<std::time::SystemTime> {
    fs::metadata("/boot")
        .ok()
        .and_then(|meta| meta.modified().ok())
}

#[test]
fn scripts_refuse_without_the_flag() {
    let before = boot_mtime();
    for name in ["build.sh", "test-boot.sh"] {
        let out = Command::new("sh")
            .arg(script(name))
            .env_remove("XZ_NATIVE_BUILD")
            .env_remove("XZ_BOOT_APPLY")
            .output()
            .unwrap();
        assert!(!out.status.success(), "{name}");
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(err.contains("refused"), "{name}: {err}");
    }
    assert!(!PathBuf::from("/etc/init.d/xinod").exists());
    assert_eq!(before, boot_mtime());
}

#[test]
fn layout_only_stages_a_temp_tree() {
    let before = boot_mtime();
    let out_dir = tempfile::tempdir().unwrap();
    let bin = boot_bin();
    let build = Command::new("sh")
        .arg(script("build.sh"))
        .arg("x86_64")
        .env("XZ_NATIVE_BUILD", "1")
        .env("XZ_NATIVE_LAYOUT_ONLY", "1")
        .env("XZ_NATIVE_OUT", out_dir.path())
        .env("XZ_BOOT_BIN", bin)
        .env_remove("XZ_BOOT_APPLY")
        .env_remove("GITHUB_ACTIONS")
        .output()
        .unwrap();
    assert!(
        build.status.success(),
        "build: {} {}",
        String::from_utf8_lossy(&build.stdout),
        String::from_utf8_lossy(&build.stderr)
    );
    let check = Command::new("sh")
        .arg(script("test-boot.sh"))
        .arg("x86_64")
        .env("XZ_NATIVE_BUILD", "1")
        .env("XZ_NATIVE_LAYOUT_ONLY", "1")
        .env("XZ_NATIVE_OUT", out_dir.path())
        .env_remove("XZ_NATIVE_QEMU")
        .env_remove("GITHUB_ACTIONS")
        .env_remove("XZ_BOOT_APPLY")
        .output()
        .unwrap();
    assert!(
        check.status.success(),
        "check: {}",
        String::from_utf8_lossy(&check.stderr)
    );
    let qemu = Command::new("sh")
        .arg(script("test-boot.sh"))
        .env("XZ_NATIVE_BUILD", "1")
        .env("XZ_NATIVE_QEMU", "1")
        .env("GITHUB_ACTIONS", "true")
        .env("XZ_NATIVE_OUT", out_dir.path())
        .output()
        .unwrap();
    assert!(!qemu.status.success());
    assert!(String::from_utf8_lossy(&qemu.stderr).contains("not wired"));
    assert!(out_dir.path().join("rootfs/etc/init.d/xinod").is_file());
    assert!(!PathBuf::from("/etc/init.d/xinod").exists());
    assert!(!PathBuf::from("/boot/xindoze").exists());
    assert_eq!(before, boot_mtime());
}

#[test]
fn build_refuses_a_host_boot_destination() {
    let out = Command::new("sh")
        .arg(script("build.sh"))
        .env("XZ_NATIVE_BUILD", "1")
        .env("XZ_NATIVE_OUT", "/boot")
        .env("XZ_BOOT_BIN", boot_bin())
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("refusing host path"));
}
