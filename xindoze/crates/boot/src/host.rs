//! Native host: the generic organs plus a power organ that reads this machine.

use crate::power::{HostPower, PowerOrgan, RefusePower};
use std::path::PathBuf;
use std::sync::Arc;
use xz_bridge::{CapabilityManifest, GenericHost, Host, Support};
use xz_types::Organ;

/// Native Edition host. Power changes are not offered.
pub struct NativeHost {
    inner: GenericHost,
}

impl NativeHost {
    /// Both paths must be absolute. Nothing is created here.
    pub fn new(home: PathBuf, data_dir: PathBuf) -> xz_types::Result<Self> {
        Ok(Self {
            inner: GenericHost::new(home, data_dir)?,
        })
    }
}

impl Host for NativeHost {
    fn name(&self) -> &str {
        "native"
    }

    fn manifest(&self) -> CapabilityManifest {
        use Support::{Full, Partial};
        CapabilityManifest::new(
            self.name(),
            &[
                ("fs", Full),
                ("proc", Partial),
                ("net", Full),
                ("power", Partial),
                ("sys", Partial),
            ],
        )
    }

    fn home(&self) -> PathBuf {
        self.inner.home()
    }

    fn data_dir(&self) -> PathBuf {
        self.inner.data_dir()
    }

    fn organs(&self) -> Vec<Arc<dyn Organ>> {
        let mut organs = self.inner.organs();
        organs.push(Arc::new(PowerOrgan::<RefusePower, HostPower>::default()));
        organs
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use xz_bridge::FAMILIES;

    #[test]
    fn manifest_matches_organs() {
        let dir = tempfile::tempdir().unwrap();
        let host = NativeHost::new(dir.path().join("home"), dir.path().join("data")).unwrap();
        let manifest = host.manifest();
        assert_eq!(manifest.host, "native");
        assert_eq!(manifest.families.len(), FAMILIES.len());
        assert_eq!(manifest.support("power"), Support::Partial);
        assert_eq!(manifest.support("ui"), Support::None);

        let mut names = BTreeSet::new();
        for organ in host.organs() {
            assert_ne!(manifest.support(organ.family()), Support::None);
            for tool in organ.tools() {
                assert!(tool.name.starts_with(&format!("{}.", organ.family())));
                assert!(names.insert(tool.name));
            }
        }
        assert!(names.contains("power.status"));
        assert!(!names.iter().any(|name| name == "power.shutdown"));
    }
}
