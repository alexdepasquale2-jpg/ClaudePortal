//! The speech model registry (`speech.toml`): whisper ggml and Kokoro files.
//!
//! It reads only `[[speech]]` tables, so the same parser works on the
//! crate's `speech.toml` and on a `models.toml` that includes them.

use crate::tts::KokoroFiles;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use xz_types::XzError;

/// The registry shipped with Xindoze, compiled in so first boot works offline.
const BUILTIN: &str = include_str!("../speech.toml");

/// Device tiers an entry can name (SPEC §5).
const TIERS: [&str; 3] = ["spore", "sprout", "apex"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpeechKind {
    /// Speech-to-text.
    Stt,
    /// Text-to-speech.
    Tts,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpeechEngine {
    /// whisper.cpp with a ggml model.
    Whisper,
    /// Kokoro-82M on ONNX Runtime.
    Kokoro,
}

/// One downloadable file of a speech model.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelFile {
    pub url: String,
    /// Hex sha256; empty until verified.
    #[serde(default)]
    pub sha256: String,
    /// Approximate download size; 0 when unknown.
    #[serde(default)]
    pub size_mb: u64,
    /// Local file name; defaults to the URL's last path segment.
    #[serde(default)]
    pub name: Option<String>,
}

impl ModelFile {
    /// The name the file is stored under in `<data>/models/`.
    pub fn file_name(&self) -> &str {
        if let Some(name) = &self.name {
            return name;
        }
        let path = self.url.split(['?', '#']).next().unwrap_or_default();
        path.rsplit('/').next().unwrap_or_default()
    }
}

/// One speech model.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpeechEntry {
    pub name: String,
    pub kind: SpeechKind,
    pub engine: SpeechEngine,
    pub tiers: Vec<String>,
    /// SPDX license id or expression.
    pub license: String,
    pub min_ram_mb: u64,
    pub files: Vec<ModelFile>,
    /// Public model card.
    #[serde(default)]
    pub source: Option<String>,
}

impl SpeechEntry {
    /// Whether the license is one the gate admits by default: Apache-2.0, MIT or BSD-*.
    pub fn is_osi(&self) -> bool {
        let l = self.license.trim();
        matches!(l, "Apache-2.0" | "MIT") || l.starts_with("BSD-")
    }

    /// Local paths of the entry's files under `models_dir`, in file order.
    pub fn paths(&self, models_dir: &Path) -> Vec<PathBuf> {
        self.files
            .iter()
            .map(|f| models_dir.join(f.file_name()))
            .collect()
    }

    /// The Kokoro speaker's files, for a Kokoro entry. The ONNX Runtime
    /// library is not a model file, so `runtime` comes from the caller.
    pub fn kokoro_files(&self, models_dir: &Path, runtime: Option<PathBuf>) -> Option<KokoroFiles> {
        match (self.engine, self.paths(models_dir).as_slice()) {
            (SpeechEngine::Kokoro, [model, voice, ..]) => Some(KokoroFiles {
                model: model.clone(),
                voice: voice.clone(),
                runtime,
            }),
            _ => None,
        }
    }
}

#[derive(Deserialize)]
struct RegistryFile {
    #[serde(default)]
    speech: Vec<SpeechEntry>,
}

/// The parsed speech registry.
#[derive(Clone, Debug)]
pub struct SpeechRegistry {
    entries: Vec<SpeechEntry>,
}

impl SpeechRegistry {
    /// The registry compiled into this build.
    pub fn builtin() -> Result<Self, XzError> {
        Self::from_str(BUILTIN)
    }

    /// Reads a registry file.
    pub fn load(path: &Path) -> Result<Self, XzError> {
        Self::from_str(&std::fs::read_to_string(path)?)
    }

    /// Parses registry TOML. Inherent so callers need no trait import.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(text: &str) -> Result<Self, XzError> {
        let file: RegistryFile =
            toml::from_str(text).map_err(|e| XzError::Parse(format!("speech registry: {e}")))?;
        let mut seen = std::collections::HashSet::new();
        for e in &file.speech {
            if !seen.insert(e.name.as_str()) {
                return Err(XzError::Parse(format!(
                    "speech registry: duplicate name {}",
                    e.name
                )));
            }
            if let Some(t) = e.tiers.iter().find(|t| !TIERS.contains(&t.as_str())) {
                return Err(XzError::Parse(format!(
                    "speech registry: {} has unknown tier {t}",
                    e.name
                )));
            }
            if e.files.is_empty() {
                return Err(XzError::Parse(format!(
                    "speech registry: {} lists no files",
                    e.name
                )));
            }
        }
        Ok(Self {
            entries: file.speech,
        })
    }

    /// Every entry, in file order.
    pub fn entries(&self) -> &[SpeechEntry] {
        &self.entries
    }

    /// Looks up an entry by name.
    pub fn get(&self, name: &str) -> Option<&SpeechEntry> {
        self.entries.iter().find(|e| e.name == name)
    }

    /// The preferred entry of `kind` for a device `tier` (`spore`, `sprout`
    /// or `apex`): the first in file order whose license passes the gate.
    pub fn pick(&self, kind: SpeechKind, tier: &str) -> Option<&SpeechEntry> {
        self.entries
            .iter()
            .find(|e| e.kind == kind && e.is_osi() && e.tiers.iter().any(|t| t == tier))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_parses_and_picks_by_tier() {
        let reg = SpeechRegistry::builtin().unwrap();
        assert!(reg.entries().iter().all(SpeechEntry::is_osi));
        let stt = |t| reg.pick(SpeechKind::Stt, t).map(|e| e.name.as_str());
        assert_eq!(stt("spore"), Some("whisper-tiny"));
        assert_eq!(stt("sprout"), Some("whisper-base"));
        assert_eq!(stt("apex"), Some("whisper-large-v3-turbo"));
        let tts = |t| reg.pick(SpeechKind::Tts, t).map(|e| e.name.as_str());
        assert_eq!(tts("spore"), None);
        assert_eq!(tts("sprout"), Some("kokoro-82m"));
        assert!(reg.entries().iter().all(|e| {
            e.files
                .iter()
                .all(|f| f.sha256.is_empty() || f.sha256.len() == 64)
        }));
    }

    #[test]
    fn file_names_and_kokoro_files() {
        let reg = SpeechRegistry::builtin().unwrap();
        let models = Path::new("/data/models");
        let tiny = reg.get("whisper-tiny").unwrap();
        assert_eq!(tiny.paths(models), vec![models.join("ggml-tiny.bin")]);
        assert_eq!(tiny.kokoro_files(models, None), None);
        let k = reg
            .get("kokoro-82m")
            .unwrap()
            .kokoro_files(models, None)
            .unwrap();
        assert_eq!(k.model, models.join("kokoro-82m-v1.0-quantized.onnx"));
        assert_eq!(k.voice, models.join("kokoro-82m-v1.0-af_heart.bin"));
        let f = ModelFile {
            url: "https://h/x/model.bin?download=1".into(),
            sha256: String::new(),
            size_mb: 0,
            name: None,
        };
        assert_eq!(f.file_name(), "model.bin");
    }

    #[test]
    fn reads_speech_tables_from_models_toml() {
        let text = r#"
            allow_restricted = false
            [[model]]
            name = "qwen3-0.6b"
            roles = ["reflex"]
            [[speech]]
            name = "w"
            kind = "stt"
            engine = "whisper"
            tiers = ["spore"]
            license = "LicenseRef-Custom"
            min_ram_mb = 1
            files = [{ url = "https://h/w.bin" }]
        "#;
        let reg = SpeechRegistry::from_str(text).unwrap();
        assert_eq!(reg.entries().len(), 1);
        // Not OSI: listed, but never picked.
        assert_eq!(reg.pick(SpeechKind::Stt, "spore"), None);
    }

    #[test]
    fn rejects_bad_entries() {
        let entry = |name: &str, tier: &str, files: &str| {
            format!(
                "[[speech]]\nname = \"{name}\"\nkind = \"stt\"\nengine = \"whisper\"\ntiers = [\"{tier}\"]\nlicense = \"MIT\"\nmin_ram_mb = 1\nfiles = {files}\n"
            )
        };
        let ok_files = "[{ url = \"https://h/a.bin\" }]";
        let dup = entry("a", "spore", ok_files) + &entry("a", "apex", ok_files);
        assert!(SpeechRegistry::from_str(&dup).is_err());
        assert!(SpeechRegistry::from_str(&entry("a", "huge", ok_files)).is_err());
        assert!(SpeechRegistry::from_str(&entry("a", "spore", "[]")).is_err());
        assert!(SpeechRegistry::from_str("[[speech]]\nname = 1").is_err());
        assert!(SpeechRegistry::from_str("").unwrap().entries().is_empty());
    }
}
