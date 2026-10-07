//! The model registry (`models.toml`, SPEC §5) and its license gate.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use xz_types::{Role, XzError};

/// The registry shipped with Xindoze, compiled in so first boot works offline.
const BUILTIN: &str = include_str!("../../../models.toml");

/// Device tier chosen by Genesis calibration (SPEC §5).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    /// Up to 4 GB of RAM.
    Spore,
    /// Up to 12 GB of RAM.
    Sprout,
    /// 16 GB or more, or a capable GPU.
    Apex,
}

impl Tier {
    /// All tiers, smallest first.
    pub const ALL: [Tier; 3] = [Tier::Spore, Tier::Sprout, Tier::Apex];
}

impl fmt::Display for Tier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Tier::Spore => "spore",
            Tier::Sprout => "sprout",
            Tier::Apex => "apex",
        })
    }
}

/// Where to download GGUF weights for embedded llama.cpp.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gguf {
    pub url: String,
    /// Hex sha256 of the file; empty until verified.
    #[serde(default)]
    pub sha256: String,
    /// Approximate download size; 0 when unknown.
    #[serde(default)]
    pub size_mb: u64,
}

impl Gguf {
    /// The file name the weights are stored under in `<data>/models/`.
    pub fn file_name(&self) -> &str {
        let path = self.url.split(['?', '#']).next().unwrap_or_default();
        path.rsplit('/').next().unwrap_or_default()
    }
}

/// One model in the registry.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelEntry {
    pub name: String,
    pub roles: Vec<Role>,
    /// Device tiers this entry is a pick for.
    pub tiers: Vec<Tier>,
    /// SPDX license id or expression.
    pub license: String,
    /// Ollama library tag.
    #[serde(default)]
    pub ollama: Option<String>,
    #[serde(default)]
    pub gguf: Option<Gguf>,
    pub min_ram_mb: u64,
    pub context: u32,
    #[serde(default)]
    pub quant: Option<String>,
    /// Public model card.
    #[serde(default)]
    pub source: Option<String>,
}

impl ModelEntry {
    /// Whether the license is OSI-approved and needs no opt-in.
    pub fn is_osi(&self) -> bool {
        is_osi_license(&self.license)
    }

    /// The model name a backend expects for this entry: the Ollama tag for
    /// `ollama`, the GGUF path under `models_dir` for `llamacpp`.
    /// `None` when the entry has no weights for that backend.
    pub fn backend_model(&self, backend: &str, models_dir: &Path) -> Option<String> {
        match backend {
            "ollama" => self.ollama.clone(),
            "llamacpp" => self.gguf.as_ref().map(|g| {
                models_dir
                    .join(g.file_name())
                    .to_string_lossy()
                    .into_owned()
            }),
            _ => None,
        }
    }

    /// Local GGUF path under `models_dir`, if the entry has GGUF weights.
    pub fn gguf_path(&self, models_dir: &Path) -> Option<PathBuf> {
        self.gguf.as_ref().map(|g| models_dir.join(g.file_name()))
    }
}

/// True for the OSI licenses the gate admits by default: Apache-2.0, MIT and BSD-*.
/// SPDX `OR` expressions pass if any side passes; `AND` expressions need every side.
pub fn is_osi_license(spdx: &str) -> bool {
    let spdx = spdx.trim().trim_start_matches('(').trim_end_matches(')');
    if spdx.contains(" OR ") {
        return spdx.split(" OR ").any(is_osi_license);
    }
    if spdx.contains(" AND ") {
        return spdx.split(" AND ").all(is_osi_license);
    }
    matches!(spdx, "Apache-2.0" | "MIT") || spdx.starts_with("BSD-")
}

#[derive(Deserialize)]
struct RegistryFile {
    #[serde(default)]
    allow_restricted: bool,
    #[serde(default, rename = "model")]
    models: Vec<ModelEntry>,
}

/// The parsed registry plus the license-gate setting.
#[derive(Clone, Debug)]
pub struct Registry {
    entries: Vec<ModelEntry>,
    allow_restricted: bool,
}

impl Registry {
    /// The registry compiled into this build (the workspace `models.toml`).
    pub fn builtin() -> Result<Self, XzError> {
        Self::from_str(BUILTIN)
    }

    /// Reads a registry file.
    pub fn load(path: &Path) -> Result<Self, XzError> {
        let text = std::fs::read_to_string(path)?;
        Self::from_str(&text)
    }

    /// Parses registry TOML. Inherent so callers need no trait import.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(text: &str) -> Result<Self, XzError> {
        let file: RegistryFile =
            toml::from_str(text).map_err(|e| XzError::Parse(format!("models.toml: {e}")))?;
        let mut seen = std::collections::HashSet::new();
        for m in &file.models {
            if !seen.insert(m.name.as_str()) {
                return Err(XzError::Parse(format!(
                    "models.toml: duplicate model name {}",
                    m.name
                )));
            }
        }
        Ok(Self {
            entries: file.models,
            allow_restricted: file.allow_restricted,
        })
    }

    /// Lets models with non-OSI licenses through the gate (a user opt-in).
    pub fn with_allow_restricted(mut self, allow: bool) -> Self {
        self.allow_restricted = allow;
        self
    }

    pub fn allows_restricted(&self) -> bool {
        self.allow_restricted
    }

    /// Whether the license gate lets this entry load.
    pub fn permits(&self, entry: &ModelEntry) -> bool {
        self.allow_restricted || entry.is_osi()
    }

    /// Every entry, including those the gate hides (for listing them as "hidden").
    pub fn all(&self) -> &[ModelEntry] {
        &self.entries
    }

    /// Entries that pass the license gate, in file order.
    pub fn entries(&self) -> impl Iterator<Item = &ModelEntry> {
        self.entries.iter().filter(|e| self.permits(e))
    }

    /// Looks up a model that passes the gate. A gated model is `Denied`, an
    /// unknown one `NotFound`.
    pub fn get(&self, name: &str) -> Result<&ModelEntry, XzError> {
        let entry = self
            .entries
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| XzError::NotFound(format!("model {name}")))?;
        if self.permits(entry) {
            Ok(entry)
        } else {
            Err(XzError::Denied(format!(
                "model {name} has license {} which is not OSI-approved; enable restricted licenses to use it",
                entry.license
            )))
        }
    }

    /// Gated entries that serve `role` on `tier`, in preference (file) order.
    pub fn entries_for(&self, role: Role, tier: Tier) -> Vec<&ModelEntry> {
        self.entries()
            .filter(|e| e.roles.contains(&role) && e.tiers.contains(&tier))
            .collect()
    }
}

impl FromStr for Registry {
    type Err = XzError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Registry::from_str(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
[[model]]
name = "open"
roles = ["cortex"]
tiers = ["sprout"]
license = "Apache-2.0"
ollama = "open:1b"
min_ram_mb = 1000
context = 4096
gguf = { url = "https://example.org/x/open-Q4.gguf?download=true", size_mb = 700 }

[[model]]
name = "closed"
roles = ["cortex", "vision"]
tiers = ["sprout", "apex"]
license = "LicenseRef-Custom"
ollama = "closed:4b"
min_ram_mb = 4000
context = 8192
"#;

    #[test]
    fn parses_and_gates() {
        let r = Registry::from_str(SAMPLE).unwrap();
        assert_eq!(r.all().len(), 2);
        assert_eq!(r.entries().count(), 1);
        assert!(r.get("open").is_ok());
        assert!(matches!(r.get("closed"), Err(XzError::Denied(_))));
        assert!(matches!(r.get("nope"), Err(XzError::NotFound(_))));
        assert_eq!(r.entries_for(Role::Cortex, Tier::Sprout).len(), 1);
        assert!(r.entries_for(Role::Vision, Tier::Apex).is_empty());

        let r = r.with_allow_restricted(true);
        assert!(r.get("closed").is_ok());
        let names: Vec<_> = r
            .entries_for(Role::Cortex, Tier::Sprout)
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(names, ["open", "closed"]);
    }

    #[test]
    fn allow_restricted_can_come_from_file() {
        let r = Registry::from_str(&format!("allow_restricted = true\n{SAMPLE}")).unwrap();
        assert!(r.allows_restricted());
        assert_eq!(r.entries().count(), 2);
    }

    #[test]
    fn rejects_bad_files() {
        let dup = format!("{SAMPLE}\n{}", &SAMPLE[SAMPLE.find("[[model]]").unwrap()..]);
        assert!(matches!(Registry::from_str(&dup), Err(XzError::Parse(_))));
        assert!(Registry::from_str("[[model]]\nname = 3").is_err());
        let bad_role = SAMPLE.replace(r#"roles = ["cortex"]"#, r#"roles = ["wizard"]"#);
        assert!(Registry::from_str(&bad_role).is_err());
    }

    #[test]
    fn license_expressions() {
        for ok in [
            "MIT",
            "Apache-2.0",
            "BSD-3-Clause",
            "MIT OR Apache-2.0",
            "(MIT AND BSD-2-Clause)",
        ] {
            assert!(is_osi_license(ok), "{ok}");
        }
        for no in [
            "LicenseRef-Gemma",
            "llama3.2",
            "CC-BY-NC-4.0",
            "MIT AND LicenseRef-X",
            "",
        ] {
            assert!(!is_osi_license(no), "{no}");
        }
    }

    #[test]
    fn backend_model_names() {
        let r = Registry::from_str(SAMPLE).unwrap();
        let e = r.get("open").unwrap();
        let dir = Path::new("/data/models");
        assert_eq!(e.backend_model("ollama", dir).as_deref(), Some("open:1b"));
        assert_eq!(
            e.gguf_path(dir),
            Some(PathBuf::from("/data/models/open-Q4.gguf"))
        );
        assert!(
            e.backend_model("llamacpp", dir)
                .unwrap()
                .ends_with("open-Q4.gguf")
        );
        assert_eq!(e.backend_model("scripted", dir), None);
    }

    #[test]
    fn builtin_registry_is_osi_by_default_and_complete() {
        let r = Registry::builtin().unwrap();
        for name in [
            "qwen3-0.6b",
            "qwen3-1.7b",
            "qwen3-4b",
            "qwen3-14b",
            "qwen3-30b-a3b",
            "phi-4-mini",
            "mistral-small-24b",
            "smolvlm-500m",
            "all-minilm-l6-v2",
            "nomic-embed-text",
            "bge-m3",
        ] {
            assert!(r.get(name).is_ok(), "{name}");
        }
        assert!(r.entries().all(ModelEntry::is_osi));
        assert!(matches!(r.get("gemma3-4b"), Err(XzError::Denied(_))));
        for e in r.all() {
            assert!(!e.roles.is_empty() && !e.tiers.is_empty(), "{}", e.name);
            if let Some(g) = &e.gguf {
                assert!(g.url.starts_with("https://") && g.file_name().ends_with(".gguf"));
                assert!(g.sha256.is_empty() || g.sha256.len() == 64, "{}", e.name);
            }
        }
        // The SPEC §5 table: first pick per tier and role.
        let first = |role, tier| r.entries_for(role, tier).first().map(|e| e.name.clone());
        assert_eq!(first(Role::Reflex, Tier::Spore).unwrap(), "qwen3-0.6b");
        assert_eq!(first(Role::Cortex, Tier::Spore).unwrap(), "qwen3-1.7b");
        assert_eq!(first(Role::Embed, Tier::Spore).unwrap(), "all-minilm-l6-v2");
        assert_eq!(first(Role::Reflex, Tier::Sprout).unwrap(), "qwen3-1.7b");
        assert_eq!(first(Role::Cortex, Tier::Sprout).unwrap(), "qwen3-4b");
        assert_eq!(
            first(Role::Embed, Tier::Sprout).unwrap(),
            "nomic-embed-text"
        );
        assert_eq!(first(Role::Vision, Tier::Sprout).unwrap(), "smolvlm-500m");
        assert_eq!(first(Role::Reflex, Tier::Apex).unwrap(), "qwen3-1.7b");
        assert_eq!(first(Role::Embed, Tier::Apex).unwrap(), "bge-m3");
        assert!(first(Role::Vision, Tier::Spore).is_none());
    }
}
