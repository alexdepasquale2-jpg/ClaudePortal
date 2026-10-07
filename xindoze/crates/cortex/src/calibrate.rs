//! Genesis calibration (SPEC §5): measure the device, pick a tier, choose a
//! model per role from the registry, optionally measure tokens per second,
//! and keep the result in `<data>/profile.json`.

use crate::registry::{ModelEntry, Registry, Tier};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use xz_types::{ChatMessage, GenRequest, ModelBackend, Role, XzError};

/// Spore covers devices up to this much RAM.
const SPORE_MAX_RAM_MB: u64 = 4 * 1024;
/// Sprout covers devices up to this much RAM; more is Apex.
const SPROUT_MAX_RAM_MB: u64 = 12 * 1024;
/// A GPU with at least this much VRAM makes a device Apex regardless of RAM.
const APEX_MIN_VRAM_MB: u64 = 8 * 1024;

/// What Genesis knows about the device.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hardware {
    /// 0 when the platform gives no answer.
    pub ram_total_mb: u64,
    pub ram_available_mb: u64,
    pub cpus: usize,
    /// Dedicated GPU memory, when the host knows it. Detection is left to the host.
    #[serde(default)]
    pub gpu_vram_mb: Option<u64>,
    pub os: String,
    pub arch: String,
}

impl Hardware {
    /// Reads RAM and CPU count from the OS (`/proc/meminfo` on Linux and
    /// Android, `GlobalMemoryStatusEx` on Windows).
    pub fn detect() -> Self {
        let (ram_total_mb, ram_available_mb) = memory_mb().unwrap_or((0, 0));
        Self {
            ram_total_mb,
            ram_available_mb,
            cpus: std::thread::available_parallelism().map_or(1, usize::from),
            gpu_vram_mb: None,
            os: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
        }
    }

    /// The tier for this device: Spore up to 4 GB, Sprout up to 12 GB, else
    /// Apex; a GPU with 8 GB+ of VRAM lifts anything above Spore to Apex.
    /// Unknown RAM (0) counts as Spore, the safe choice.
    pub fn tier(&self) -> Tier {
        if self.ram_total_mb <= SPORE_MAX_RAM_MB {
            Tier::Spore
        } else if self.gpu_vram_mb.is_some_and(|v| v >= APEX_MIN_VRAM_MB) {
            Tier::Apex
        } else if self.ram_total_mb <= SPROUT_MAX_RAM_MB {
            Tier::Sprout
        } else {
            Tier::Apex
        }
    }

    /// Whether the device changed enough to re-run calibration.
    pub fn differs_from(&self, other: &Hardware) -> bool {
        // RAM totals wobble slightly between boots (firmware reservations).
        let ram_changed =
            self.ram_total_mb.abs_diff(other.ram_total_mb) * 20 > self.ram_total_mb.max(1);
        ram_changed
            || self.cpus != other.cpus
            || self.gpu_vram_mb != other.gpu_vram_mb
            || self.os != other.os
            || self.arch != other.arch
    }
}

/// The stored result of calibration.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    pub hardware: Hardware,
    pub tier: Tier,
    /// Backend the role choices were made for (`ollama`, `llamacpp`).
    pub backend: String,
    /// Registry model name per role.
    pub roles: BTreeMap<Role, String>,
    /// Measured generation speed per registry model name.
    #[serde(default)]
    pub tokens_per_sec: BTreeMap<String, f64>,
    pub created_ms: i64,
}

impl Profile {
    pub const FILE_NAME: &'static str = "profile.json";

    /// Calibrates without measuring: tier from `hw`, roles from `registry`.
    pub fn plan(registry: &Registry, hw: Hardware, backend: &str) -> Self {
        let tier = hw.tier();
        let roles = choose_roles(registry, &hw, tier, backend);
        Self {
            hardware: hw,
            tier,
            backend: backend.into(),
            roles,
            tokens_per_sec: BTreeMap::new(),
            created_ms: xz_types::now_ms(),
        }
    }

    /// Measures tokens per second on `backend` for each model assigned to
    /// Reflex, Cortex or Oracle. Models already measured are skipped.
    pub async fn measure(
        &mut self,
        backend: &dyn ModelBackend,
        registry: &Registry,
        models_dir: &Path,
    ) -> Result<(), XzError> {
        let names: Vec<String> = self
            .roles
            .iter()
            .filter(|(r, _)| matches!(r, Role::Reflex | Role::Cortex | Role::Oracle))
            .map(|(_, n)| n.clone())
            .collect();
        for name in names {
            if self.tokens_per_sec.contains_key(&name) {
                continue;
            }
            let model = registry
                .get(&name)?
                .backend_model(backend.id(), models_dir)
                .ok_or_else(|| {
                    XzError::NotFound(format!("model {name} for backend {}", backend.id()))
                })?;
            let tps = measure_tokens_per_sec(backend, &model).await?;
            self.tokens_per_sec.insert(name, tps);
        }
        Ok(())
    }

    pub fn path(data_dir: &Path) -> PathBuf {
        data_dir.join(Self::FILE_NAME)
    }

    /// Reads `<data>/profile.json`; `None` if calibration never ran.
    pub fn load(data_dir: &Path) -> Result<Option<Self>, XzError> {
        match std::fs::read(Self::path(data_dir)) {
            Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Writes `<data>/profile.json` atomically (temp file, then rename).
    pub fn save(&self, data_dir: &Path) -> Result<(), XzError> {
        std::fs::create_dir_all(data_dir)?;
        let path = Self::path(data_dir);
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }
}

/// Picks a registry model per role for a device. For each role the device's
/// tier is tried first, then lower tiers; the first entry (in registry order)
/// that fits in RAM and has weights for `backend` wins. Oracle is assigned
/// only when a model other than the Cortex pick fits; otherwise the Cortex
/// stands in for it at runtime.
pub fn choose_roles(
    registry: &Registry,
    hw: &Hardware,
    tier: Tier,
    backend: &str,
) -> BTreeMap<Role, String> {
    let fits = |e: &ModelEntry| e.min_ram_mb <= hw.ram_total_mb && has_weights(e, backend);
    let pick = |role: Role, skip: Option<&str>| {
        Tier::ALL
            .iter()
            .rev()
            .filter(|t| **t <= tier)
            .find_map(|t| {
                registry
                    .entries_for(role, *t)
                    .into_iter()
                    .find(|e| fits(e) && Some(e.name.as_str()) != skip)
            })
            .map(|e| e.name.clone())
    };
    let mut roles = BTreeMap::new();
    for role in [Role::Reflex, Role::Cortex, Role::Embed, Role::Vision] {
        if let Some(name) = pick(role, None) {
            roles.insert(role, name);
        }
    }
    let cortex = roles.get(&Role::Cortex).cloned();
    if let Some(name) = pick(Role::Oracle, cortex.as_deref()) {
        roles.insert(Role::Oracle, name);
    }
    roles
}

fn has_weights(e: &ModelEntry, backend: &str) -> bool {
    match backend {
        "ollama" => e.ollama.is_some(),
        "llamacpp" => e.gguf.is_some(),
        // Other backends (Hive peers, test scripts) resolve names themselves.
        _ => true,
    }
}

/// Generation speed of `model` on `backend`, after one warm-up call so model
/// loading is not counted.
pub async fn measure_tokens_per_sec(
    backend: &dyn ModelBackend,
    model: &str,
) -> Result<f64, XzError> {
    let mut warm = GenRequest::new(Role::Cortex, vec![ChatMessage::user("Say OK.")]);
    warm.max_tokens = 4;
    backend.generate(model, &warm).await?;

    let mut req = GenRequest::new(
        Role::Cortex,
        vec![ChatMessage::user(
            "Count from 1 to 50, separated by spaces.",
        )],
    );
    req.max_tokens = 64;
    req.temperature = 0.0;
    let start = Instant::now();
    let resp = backend.generate(model, &req).await?;
    let millis = match resp.millis {
        0 => start.elapsed().as_millis() as u64,
        ms => ms,
    };
    if resp.tokens_out == 0 {
        return Err(XzError::Model(format!("{model} generated no tokens")));
    }
    Ok(f64::from(resp.tokens_out) * 1000.0 / millis.max(1) as f64)
}

/// Total and available RAM in MB.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn memory_mb() -> Option<(u64, u64)> {
    parse_meminfo(&std::fs::read_to_string("/proc/meminfo").ok()?)
}

#[cfg(windows)]
fn memory_mb() -> Option<(u64, u64)> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: MEMORYSTATUSEX is plain data; zeroed is a valid initial state,
    // and dwLength is set as the API requires before the call.
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    // SAFETY: `status` is a valid, writable MEMORYSTATUSEX for the duration of the call.
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return None;
    }
    Some((
        status.ullTotalPhys / (1024 * 1024),
        status.ullAvailPhys / (1024 * 1024),
    ))
}

#[cfg(not(any(target_os = "linux", target_os = "android", windows)))]
fn memory_mb() -> Option<(u64, u64)> {
    None
}

/// Parses `MemTotal` and `MemAvailable` (in kB) from `/proc/meminfo`.
#[cfg_attr(not(any(target_os = "linux", target_os = "android")), allow(dead_code))]
fn parse_meminfo(text: &str) -> Option<(u64, u64)> {
    let field = |name: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(name)?.strip_prefix(':'))
            .and_then(|v| v.trim().trim_end_matches("kB").trim().parse::<u64>().ok())
    };
    let total = field("MemTotal")?;
    // Old kernels lack MemAvailable; MemFree is the closest stand-in.
    let available = field("MemAvailable")
        .or_else(|| field("MemFree"))
        .unwrap_or(0);
    Some((total / 1024, available / 1024))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scripted::ScriptedBackend;

    fn hw(ram_gb: u64) -> Hardware {
        Hardware {
            ram_total_mb: ram_gb * 1024 - 300,
            ram_available_mb: ram_gb * 512,
            cpus: 8,
            gpu_vram_mb: None,
            os: "linux".into(),
            arch: "x86_64".into(),
        }
    }

    fn roles(ram_gb: u64, backend: &str) -> Vec<(Role, String)> {
        let reg = Registry::builtin().unwrap();
        let p = Profile::plan(&reg, hw(ram_gb), backend);
        p.roles.into_iter().collect()
    }

    fn r(role: Role, name: &str) -> (Role, String) {
        (role, name.to_string())
    }

    #[test]
    fn tiers() {
        assert_eq!(hw(4).tier(), Tier::Spore);
        assert_eq!(hw(6).tier(), Tier::Sprout);
        assert_eq!(hw(12).tier(), Tier::Sprout);
        assert_eq!(hw(16).tier(), Tier::Apex);
        let mut gpu = hw(8);
        gpu.gpu_vram_mb = Some(12 * 1024);
        assert_eq!(gpu.tier(), Tier::Apex);
        let mut tiny = hw(2);
        tiny.gpu_vram_mb = Some(12 * 1024);
        assert_eq!(tiny.tier(), Tier::Spore);
        let mut unknown = hw(8);
        unknown.ram_total_mb = 0;
        assert_eq!(unknown.tier(), Tier::Spore);
    }

    #[test]
    fn spec_table_picks_for_ollama() {
        assert_eq!(
            roles(4, "ollama"),
            [
                r(Role::Reflex, "qwen3-0.6b"),
                r(Role::Cortex, "qwen3-1.7b"),
                r(Role::Embed, "all-minilm-l6-v2")
            ]
        );
        // SmolVLM has no Ollama tag, so Sprout has no local vision model.
        assert_eq!(
            roles(8, "ollama"),
            [
                r(Role::Reflex, "qwen3-1.7b"),
                r(Role::Cortex, "qwen3-4b"),
                r(Role::Embed, "nomic-embed-text")
            ]
        );
        assert_eq!(
            roles(16, "ollama"),
            [
                r(Role::Reflex, "qwen3-1.7b"),
                r(Role::Cortex, "qwen3-14b"),
                r(Role::Embed, "bge-m3"),
                r(Role::Vision, "qwen2.5-vl-7b"),
            ]
        );
        assert_eq!(
            roles(64, "ollama"),
            [
                r(Role::Reflex, "qwen3-1.7b"),
                r(Role::Cortex, "qwen3-30b-a3b"),
                r(Role::Oracle, "mistral-small-24b"),
                r(Role::Embed, "bge-m3"),
                r(Role::Vision, "qwen2.5-vl-7b"),
            ]
        );
    }

    #[test]
    fn llamacpp_picks_need_gguf_and_fall_back_a_tier() {
        // No embed or vision entry ships GGUF weights yet.
        assert_eq!(
            roles(16, "llamacpp"),
            [r(Role::Reflex, "qwen3-1.7b"), r(Role::Cortex, "qwen3-14b")]
        );
        let reg = Registry::builtin().unwrap();
        // Sprout forced on a small device: within the tier, 4B does not fit, so 1.7B stands in.
        let mut small = hw(4);
        small.ram_total_mb = 3000;
        let picks = choose_roles(&reg, &small, Tier::Sprout, "llamacpp");
        assert_eq!(picks[&Role::Cortex], "qwen3-1.7b");
        // Smaller still: no Sprout reflex fits, so the Spore pick is used.
        small.ram_total_mb = 1500;
        let picks = choose_roles(&reg, &small, Tier::Sprout, "llamacpp");
        assert_eq!(picks[&Role::Reflex], "qwen3-0.6b");
        assert!(!picks.contains_key(&Role::Cortex));
    }

    #[test]
    fn restricted_models_only_with_opt_in() {
        let reg = Registry::builtin().unwrap().with_allow_restricted(true);
        let mut p = Profile::plan(&reg, hw(8), "ollama");
        // Gemma is listed after the OSI picks, so it only fills the empty vision slot.
        assert_eq!(p.roles.remove(&Role::Vision).as_deref(), Some("gemma3-4b"));
        assert_eq!(p.roles[&Role::Cortex], "qwen3-4b");
    }

    #[test]
    fn hardware_change_detection() {
        let a = hw(16);
        let mut b = a.clone();
        b.ram_total_mb += 200;
        assert!(!a.differs_from(&b));
        b.ram_total_mb = 32 * 1024;
        assert!(a.differs_from(&b));
        let mut c = a.clone();
        c.gpu_vram_mb = Some(8192);
        assert!(a.differs_from(&c));
    }

    #[test]
    fn detect_reads_this_machine() {
        let h = Hardware::detect();
        assert!(h.cpus >= 1);
        assert_eq!(h.os, std::env::consts::OS);
        #[cfg(any(target_os = "linux", target_os = "android", windows))]
        assert!(h.ram_total_mb > 0 && h.ram_available_mb <= h.ram_total_mb);
    }

    #[test]
    fn meminfo_parsing() {
        let text = "MemTotal:       16384000 kB\nMemFree:         1000000 kB\nMemAvailable:    8192000 kB\n";
        assert_eq!(parse_meminfo(text), Some((16000, 8000)));
        assert_eq!(
            parse_meminfo("MemTotal: 2048 kB\nMemFree: 1024 kB"),
            Some((2, 1))
        );
        assert_eq!(parse_meminfo("garbage"), None);
    }

    #[tokio::test]
    async fn profile_roundtrip_and_measure() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Profile::load(dir.path()).unwrap(), None);
        let reg = Registry::builtin().unwrap();
        let mut p = Profile::plan(&reg, hw(8), "ollama");
        // 50 words per reply; the scripted backend reports ~0 ms, so the wall clock counts.
        let words = (1..=50)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(" ");
        let sb = ScriptedBackend::always(words).with_id("ollama");
        p.measure(&sb, &reg, dir.path()).await.unwrap();
        assert_eq!(p.tokens_per_sec.len(), 2, "{:?}", p.tokens_per_sec);
        assert!(p.tokens_per_sec.values().all(|t| *t > 0.0));
        let models: Vec<String> = sb.calls().iter().map(|c| c.model.clone()).collect();
        assert!(
            models.contains(&"qwen3:1.7b".to_string()) && models.contains(&"qwen3:4b".to_string())
        );

        p.save(&dir.path().join("nested")).unwrap();
        let back = Profile::load(&dir.path().join("nested")).unwrap().unwrap();
        assert_eq!(back, p);
        let text = std::fs::read_to_string(Profile::path(&dir.path().join("nested"))).unwrap();
        assert!(text.contains("\"cortex\": \"qwen3-4b\""), "{text}");
    }

    #[tokio::test]
    async fn measure_rejects_silent_models() {
        let sb = ScriptedBackend::always("");
        assert!(measure_tokens_per_sec(&sb, "m").await.is_err());
    }
}
