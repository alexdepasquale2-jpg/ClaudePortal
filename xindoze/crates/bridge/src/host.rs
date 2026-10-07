//! The Universal Bridge's host contract (SPEC §3.1).
//!
//! A [`Host`] reports which capability families this device supports and
//! hands out the Organs that serve them. Families this crate does not
//! serve (media, sensor, power, people, ui) are reported as `None`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use xz_types::{Organ, Result, XzError};

use crate::{FsOrgan, NetOrgan, ProcOrgan, SysOrgan};

/// How fully a host supports a capability family.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Support {
    Full,
    /// Some tools of the family work, or only in a restricted form.
    Partial,
    None,
}

/// Every capability family of SPEC §3.1.
pub const FAMILIES: &[&str] = &[
    "fs", "proc", "net", "clip", "notify", "media", "sensor", "power", "people", "ui", "sys",
];

/// What one device supports, family by family. Every family in
/// [`FAMILIES`] is listed, so a missing capability is explicit.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityManifest {
    pub host: String,
    pub families: BTreeMap<String, Support>,
}

impl CapabilityManifest {
    /// A manifest where the listed families have the given support and
    /// every other family has none.
    pub fn new(host: &str, supported: &[(&str, Support)]) -> Self {
        let mut families: BTreeMap<String, Support> = FAMILIES
            .iter()
            .map(|f| (f.to_string(), Support::None))
            .collect();
        for (f, s) in supported {
            families.insert(f.to_string(), *s);
        }
        Self {
            host: host.into(),
            families,
        }
    }

    /// Support for `family`; unknown families have none.
    pub fn support(&self, family: &str) -> Support {
        self.families.get(family).copied().unwrap_or(Support::None)
    }
}

/// A device Xindoze runs on.
pub trait Host: Send + Sync {
    /// Short host name, e.g. `linux` or `generic`.
    fn name(&self) -> &str;
    /// The capability families this host supports right now.
    fn manifest(&self) -> CapabilityManifest;
    /// The user's home folder: `~` and relative paths resolve against it.
    fn home(&self) -> PathBuf;
    /// Xindoze's own data (engram.db, charter.toml, trash, models, ...).
    fn data_dir(&self) -> PathBuf;
    /// The core Organs this host serves.
    fn organs(&self) -> Vec<Arc<dyn Organ>>;
}

fn absolute(what: &str, p: PathBuf) -> Result<PathBuf> {
    if p.is_absolute() {
        Ok(p)
    } else {
        Err(XzError::InvalidArgs(format!(
            "{what} must be an absolute path, got {}",
            p.display()
        )))
    }
}

/// A host built only on the standard library: files, processes (no
/// default-app launcher), network and device info. The Android shell
/// uses it, with the shell providing the rest; tests use it with
/// temporary folders.
#[derive(Clone, Debug)]
pub struct GenericHost {
    home: PathBuf,
    data_dir: PathBuf,
}

impl GenericHost {
    /// Both paths must be absolute.
    pub fn new(home: PathBuf, data_dir: PathBuf) -> Result<Self> {
        Ok(Self {
            home: absolute("home", home)?,
            data_dir: absolute("data_dir", data_dir)?,
        })
    }
}

impl Host for GenericHost {
    fn name(&self) -> &str {
        "generic"
    }

    fn manifest(&self) -> CapabilityManifest {
        use Support::{Full, Partial};
        CapabilityManifest::new(
            self.name(),
            &[
                ("fs", Full),
                // No proc.open: opening documents needs the platform shell.
                ("proc", Partial),
                ("net", Full),
                // Device info only; no settings.
                ("sys", Partial),
            ],
        )
    }

    fn home(&self) -> PathBuf {
        self.home.clone()
    }

    fn data_dir(&self) -> PathBuf {
        self.data_dir.clone()
    }

    fn organs(&self) -> Vec<Arc<dyn Organ>> {
        vec![
            Arc::new(FsOrgan::new(self.home.clone(), self.data_dir.clone())),
            Arc::new(ProcOrgan::new(self.home.clone(), self.data_dir.clone()).without_open()),
            Arc::new(NetOrgan::new()),
            Arc::new(SysOrgan::new()),
        ]
    }
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
pub use desktop::DesktopHost;

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
mod desktop {
    use super::*;
    use crate::{ClipOrgan, NotifyOrgan};

    /// The data folder's name inside the platform data directory.
    const DATA_DIR_NAME: &str = if cfg!(target_os = "linux") {
        "xindoze"
    } else {
        "Xindoze"
    };

    /// Windows, macOS and Linux desktops.
    #[derive(Clone)]
    pub struct DesktopHost {
        home: PathBuf,
        data_dir: PathBuf,
        /// Shared by every `organs()` call: X11 clipboard text lives only
        /// as long as its owner's handle.
        clip: ClipOrgan,
    }

    impl DesktopHost {
        /// The current user's home and the platform data folder: Linux
        /// `~/.local/share/xindoze` (or `$XDG_DATA_HOME/xindoze`), Windows
        /// `%APPDATA%\Xindoze`, macOS `~/Library/Application Support/Xindoze`.
        /// Nothing is created on disk.
        pub fn new() -> Result<Self> {
            let home = dirs::home_dir()
                .ok_or_else(|| XzError::NotFound("the home folder is unknown".into()))?;
            let data = dirs::data_dir()
                .ok_or_else(|| XzError::NotFound("the data folder is unknown".into()))?;
            Self::with_dirs(home, data.join(DATA_DIR_NAME))
        }

        /// A desktop host with explicit folders (both absolute).
        pub fn with_dirs(home: PathBuf, data_dir: PathBuf) -> Result<Self> {
            Ok(Self {
                home: absolute("home", home)?,
                data_dir: absolute("data_dir", data_dir)?,
                clip: ClipOrgan::new(),
            })
        }
    }

    impl Host for DesktopHost {
        fn name(&self) -> &str {
            std::env::consts::OS
        }

        fn manifest(&self) -> CapabilityManifest {
            use Support::{Full, Partial};
            let session = |up: bool| if up { Full } else { Support::None };
            CapabilityManifest::new(
                self.name(),
                &[
                    ("fs", Full),
                    ("proc", Full),
                    ("net", Full),
                    ("clip", session(has_display())),
                    ("notify", session(has_notification_bus())),
                    // Device info only; settings stay with the OS (SPEC §3.1).
                    ("sys", Partial),
                ],
            )
        }

        fn home(&self) -> PathBuf {
            self.home.clone()
        }

        fn data_dir(&self) -> PathBuf {
            self.data_dir.clone()
        }

        fn organs(&self) -> Vec<Arc<dyn Organ>> {
            vec![
                Arc::new(FsOrgan::new(self.home.clone(), self.data_dir.clone())),
                Arc::new(ProcOrgan::new(self.home.clone(), self.data_dir.clone())),
                Arc::new(NetOrgan::new()),
                Arc::new(self.clip.clone()),
                Arc::new(NotifyOrgan::new()),
                Arc::new(SysOrgan::new()),
            ]
        }
    }

    fn env_set(name: &str) -> bool {
        std::env::var_os(name).is_some_and(|v| !v.is_empty())
    }

    /// The clipboard backend speaks X11 (XWayland included) on Linux.
    fn has_display() -> bool {
        !cfg!(target_os = "linux") || env_set("DISPLAY")
    }

    /// Linux notifications need a D-Bus session bus.
    fn has_notification_bus() -> bool {
        if !cfg!(target_os = "linux") {
            return true;
        }
        env_set("DBUS_SESSION_BUS_ADDRESS")
            || std::env::var_os("XDG_RUNTIME_DIR")
                .is_some_and(|d| PathBuf::from(d).join("bus").exists())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// Organs must agree with the manifest, and tool names with families.
    fn check(host: &dyn Host) {
        let m = host.manifest();
        assert_eq!(m.host, host.name());
        assert_eq!(m.families.len(), FAMILIES.len());
        let mut names = BTreeSet::new();
        for organ in host.organs() {
            let family = organ.family().to_string();
            assert!(FAMILIES.contains(&family.as_str()), "{family}");
            for t in organ.tools() {
                assert!(t.name.starts_with(&format!("{family}.")), "{}", t.name);
                assert!(t.first_party);
                assert!(names.insert(t.name.clone()), "duplicate {}", t.name);
            }
        }
        for f in ["media", "sensor", "power", "people", "ui"] {
            assert_eq!(m.support(f), Support::None);
        }
        assert_eq!(m.support("fs"), Support::Full);
        assert_eq!(m.support("nonsense"), Support::None);
    }

    #[test]
    fn generic_host() {
        let t = tempfile::tempdir().unwrap();
        let h = GenericHost::new(t.path().join("home"), t.path().join("data")).unwrap();
        check(&h);
        assert_eq!(h.manifest().support("proc"), Support::Partial);
        assert_eq!(h.manifest().support("clip"), Support::None);
        let families: Vec<_> = h.organs().iter().map(|o| o.family().to_string()).collect();
        assert_eq!(families, ["fs", "proc", "net", "sys"]);
        assert!(GenericHost::new("rel".into(), t.path().into()).is_err());
        let json = serde_json::to_value(h.manifest()).unwrap();
        assert_eq!(json["families"]["proc"], "partial");
    }

    #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
    #[test]
    fn desktop_host() {
        let t = tempfile::tempdir().unwrap();
        let h = DesktopHost::with_dirs(t.path().join("home"), t.path().join("data")).unwrap();
        check(&h);
        assert_eq!(h.organs().len(), 6);
        assert_eq!(h.manifest().support("proc"), Support::Full);
        // The default folders are computed, never created.
        if let Ok(real) = DesktopHost::new() {
            let name = real
                .data_dir()
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned();
            let expect = if cfg!(target_os = "linux") {
                "xindoze"
            } else {
                "Xindoze"
            };
            assert_eq!(name, expect);
        }
    }
}
