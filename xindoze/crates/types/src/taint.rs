use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Provenance of untrusted content (SPEC §3.4, §6).
///
/// A source is a short label such as `web:example.com`, `file:/path`,
/// `msg:sms`, or `ui:Excel`. An empty set means the value is clean.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Taint {
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub sources: BTreeSet<String>,
}

impl Taint {
    pub fn none() -> Self {
        Self::default()
    }

    pub fn from_source(source: impl Into<String>) -> Self {
        let mut sources = BTreeSet::new();
        sources.insert(source.into());
        Self { sources }
    }

    pub fn is_clean(&self) -> bool {
        self.sources.is_empty()
    }

    pub fn merge(&mut self, other: &Taint) {
        self.sources.extend(other.sources.iter().cloned());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_unions_sources() {
        let mut a = Taint::from_source("web:a.com");
        a.merge(&Taint::from_source("msg:sms"));
        a.merge(&Taint::none());
        assert_eq!(a.sources.len(), 2);
        assert!(!a.is_clean());
        assert!(Taint::none().is_clean());
    }
}
