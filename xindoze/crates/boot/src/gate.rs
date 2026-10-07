//! Where boot files may be written.
//!
//! Preview writes a staging tree. Apply is the only path that may target a
//! real login-integration directory, and only when [`Auth::Explicit`] is
//! passed. Host boot firmware paths are refused either way, so a test cannot
//! change how this machine starts.

use crate::error::BootError;
use std::path::Path;

/// Whether the caller set `XZ_BOOT_APPLY=1`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Auth {
    Denied,
    Explicit,
}

impl Auth {
    /// Reads `XZ_BOOT_APPLY`. Anything other than `1` is denied.
    pub fn from_env() -> Self {
        if std::env::var("XZ_BOOT_APPLY").ok().as_deref() == Some("1") {
            Auth::Explicit
        } else {
            Auth::Denied
        }
    }
}

/// How a destination relates to the machine that is running the code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PathClass {
    /// A staging directory. Preview may write here.
    Safe,
    /// A real login or host-init directory. Apply may write here.
    BootIntegration,
    /// Firmware, EFI, Winlogon, or another path this crate never writes.
    Forbidden,
}

/// Classifies `path` without touching the filesystem.
pub fn classify(path: &Path) -> PathClass {
    let raw = path.to_string_lossy();
    let lower = raw.replace('\\', "/").to_ascii_lowercase();
    let trimmed = lower.trim_end_matches('/').to_string();

    if trimmed.contains("winlogon")
        || trimmed.contains("appinit_dlls")
        || trimmed.contains("image file execution options")
    {
        return PathClass::Forbidden;
    }

    let windows = is_windows_abs(&trimmed);
    let unix = trimmed.starts_with('/');
    if !windows && !unix {
        return PathClass::Forbidden;
    }

    let rest = if windows {
        &trimmed[2..]
    } else {
        trimmed.as_str()
    };

    const FORBIDDEN_ROOTS: &[&str] = &[
        "/boot",
        "/efi",
        "/sys",
        "/proc",
        "/dev",
        "/run/systemd",
        "/usr/lib/systemd",
        "/lib/systemd",
    ];
    for prefix in FORBIDDEN_ROOTS {
        if rest == *prefix || rest.starts_with(&format!("{prefix}/")) {
            return PathClass::Forbidden;
        }
    }
    if rest.starts_with("/windows/boot")
        || rest.starts_with("/windows/system32")
        || rest.starts_with("/windows/sysnative")
    {
        return PathClass::Forbidden;
    }

    if rest.contains("/start menu/programs/startup") || rest.ends_with("/autostart") {
        return PathClass::BootIntegration;
    }
    if rest == "/etc"
        || rest.starts_with("/etc/init.d")
        || rest.starts_with("/etc/systemd")
        || rest.starts_with("/etc/runlevels")
        || rest.starts_with("/etc/rc")
        || rest.starts_with("/etc/xdg/autostart")
    {
        return PathClass::BootIntegration;
    }

    PathClass::Safe
}

fn is_windows_abs(lower: &str) -> bool {
    let bytes = lower.as_bytes();
    bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/'
}

/// Preview: staging trees only.
pub fn allow_preview(dest: &Path) -> Result<(), BootError> {
    match classify(dest) {
        PathClass::Safe => Ok(()),
        PathClass::BootIntegration => Err(BootError::NeedsFlag(dest.display().to_string())),
        PathClass::Forbidden => Err(BootError::HostBootPath(dest.display().to_string())),
    }
}

/// Apply: staging or login integration, never firmware, and only with the flag.
pub fn allow_apply(dest: &Path, auth: Auth) -> Result<(), BootError> {
    if auth != Auth::Explicit {
        return Err(BootError::NeedsFlag(dest.display().to_string()));
    }
    match classify(dest) {
        PathClass::Forbidden => Err(BootError::HostBootPath(dest.display().to_string())),
        PathClass::Safe | PathClass::BootIntegration => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn firmware_is_never_a_staging_dir() {
        for path in [
            "/boot",
            "/boot/efi",
            "/efi",
            "/sys/firmware",
            "/proc/sys",
            "/dev/sda",
            "/usr/lib/systemd/system",
            "/lib/systemd/system",
            r"C:\Windows\Boot\EFI",
            r"C:\Windows\System32\config",
            r"C:\Windows\System32\Winlogon",
            "relative/boot",
        ] {
            assert_eq!(classify(Path::new(path)), PathClass::Forbidden, "{path}");
            assert!(
                allow_apply(Path::new(path), Auth::Explicit).is_err(),
                "{path}"
            );
        }
    }

    #[test]
    fn login_integration_needs_the_flag() {
        for path in [
            "/etc/init.d",
            "/etc/runlevels/default",
            "/etc/xdg/autostart",
            r"C:\Users\me\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup",
            "/home/me/.config/autostart",
        ] {
            assert_eq!(
                classify(Path::new(path)),
                PathClass::BootIntegration,
                "{path}"
            );
            assert!(allow_preview(Path::new(path)).is_err(), "{path}");
            assert!(
                allow_apply(Path::new(path), Auth::Denied).is_err(),
                "{path}"
            );
            assert!(
                allow_apply(Path::new(path), Auth::Explicit).is_ok(),
                "{path}"
            );
        }
    }

    #[test]
    fn staging_tree_is_safe_even_if_it_contains_etc() {
        let staging = Path::new("/tmp/xindoze-native/rootfs/etc/init.d");
        assert_eq!(classify(staging), PathClass::Safe);
        assert!(allow_preview(staging).is_ok());
        assert!(allow_apply(staging, Auth::Denied).is_err());
        assert!(allow_apply(staging, Auth::Explicit).is_ok());
    }
}
