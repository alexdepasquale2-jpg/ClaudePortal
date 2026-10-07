//! `--service` prints the boot line and does not install host boot files.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

#[test]
fn service_mode_is_in_process() {
    let mut exe = std::env::current_exe().unwrap();
    exe.pop();
    exe.pop();
    exe.push("xinod");
    let mut child = Command::new(exe)
        .arg("--service")
        .env_remove("XZ_BOOT_APPLY")
        .env_remove("XZ_HOME")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdout = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    // Lines can arrive in separate pipe reads (Windows), so read until the ready line.
    thread::spawn(move || {
        let mut text = String::new();
        let mut buf = [0u8; 256];
        loop {
            let n = stdout.read(&mut buf).unwrap_or(0);
            if n == 0 {
                break;
            }
            text.push_str(&String::from_utf8_lossy(&buf[..n]));
            if text.contains("xinod service ready") {
                break;
            }
        }
        let _ = tx.send(text);
    });
    let line = rx.recv_timeout(Duration::from_secs(15)).unwrap();
    let _ = child.kill();
    let _ = child.wait();
    assert!(line.contains("Xindoze has evolved."), "{line}");
    assert!(line.contains("xinod service ready"), "{line}");
    assert!(!std::path::Path::new("/etc/init.d/xinod").exists());
    assert!(!std::path::Path::new("/boot/xindoze").exists());
}
