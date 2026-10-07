/// What this device can do. Genomes degrade when a family is missing.
pub trait Host {
    fn os(&self) -> &str;
    fn families(&self) -> &[&str];
}

/// The host the process is running on. Phase 0 exposes fs, proc, and net.
pub struct ThisHost;

impl Host for ThisHost {
    fn os(&self) -> &str {
        std::env::consts::OS
    }

    fn families(&self) -> &[&str] {
        &["fs", "proc", "net"]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_host_names_phase0_families() {
        let host = ThisHost;
        assert!(!host.os().is_empty());
        assert_eq!(host.families(), ["fs", "proc", "net"]);
    }
}
