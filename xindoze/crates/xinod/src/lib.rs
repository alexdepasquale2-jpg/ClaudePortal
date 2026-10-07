//! `xinod` is the process. `xz` is its command-line Intent Bar.
//!
//! Phase 0 runs the organism loop in-process. A socket between `xz` and a
//! long-lived daemon is TODO(phase 1).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use xz_core::{Session, SessionConfig, offline_config};
use xz_cortex::{Cortex, OllamaBackend};
use xz_genome::Genome;
use xz_types::{AlwaysYes, Confirmer, Inference, ModelBackend, Outcome, Result, XzError};

const PRIME: &str = include_str!("../../../genomes/prime/GENOME.md");

/// Directory of Seed Bank genomes. `XZ_GENOMES` wins, then the source tree.
pub fn genomes_root() -> PathBuf {
    if let Ok(p) = std::env::var("XZ_GENOMES")
        && !p.trim().is_empty()
    {
        return PathBuf::from(p);
    }
    let baked = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../genomes");
    if baked.join("prime/GENOME.md").is_file() {
        return baked;
    }
    PathBuf::from("genomes")
}

pub fn prime_text() -> String {
    let path = genomes_root().join("prime/GENOME.md");
    fs::read_to_string(&path).unwrap_or_else(|_| PRIME.to_string())
}

/// Home directory and the data directory under it (`~/.xindoze`).
pub fn paths() -> Result<(PathBuf, PathBuf)> {
    let home = match std::env::var("XZ_HOME") {
        Ok(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => default_home()?,
    };
    let data = match std::env::var("XZ_DATA") {
        Ok(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => home.join(".xindoze"),
    };
    Ok((home, data))
}

fn default_home() -> Result<PathBuf> {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let raw = std::env::var(key)
        .map_err(|_| XzError::InvalidArgs(format!("${key} is unset; set XZ_HOME")))?;
    if raw.is_empty() {
        return Err(XzError::InvalidArgs("home is empty".into()));
    }
    Ok(PathBuf::from(raw))
}

/// Ollama when `XZ_MODEL` is set and the server answers, otherwise the
/// offline reflex. The reflex is a proposer only; the Warden still decides.
pub async fn inference(home: &Path) -> Arc<dyn Inference> {
    if std::env::var("XZ_BACKEND").ok().as_deref() != Some("offline")
        && let Ok(model) = std::env::var("XZ_MODEL")
        && !model.trim().is_empty()
        && let Ok(ollama) = OllamaBackend::from_env()
        && ollama.available().await
    {
        return Arc::new(Cortex::single(Arc::new(ollama), model.trim()));
    }
    Arc::new(Cortex::single(
        Arc::new(xz_core::OfflineReflex::new(home.to_path_buf())),
        "offline-reflex",
    ))
}

pub async fn open_session(confirmer: Arc<dyn Confirmer>) -> Result<Session> {
    let (home, data) = paths()?;
    let cortex = inference(&home).await;
    Session::open(SessionConfig {
        home,
        data_dir: data,
        cortex,
        confirmer,
        genome_text: prime_text(),
        device_id: device_id(),
    })
}

fn device_id() -> String {
    if let Ok(id) = fs::read_to_string("/etc/machine-id") {
        let id = id.trim();
        if !id.is_empty() {
            return format!("dev-{id}");
        }
    }
    "local".into()
}

/// Runs every Seed Bank eval against the offline reflex in a throwaway home.
pub async fn eval_all(genomes: &Path) -> Result<EvalReport> {
    let mut files = Vec::new();
    collect(genomes, &mut files)?;
    files.sort();
    if files.is_empty() {
        return Err(XzError::NotFound(format!(
            "no GENOME.md under {}",
            genomes.display()
        )));
    }
    let mut report = EvalReport::default();
    for path in files {
        let text = fs::read_to_string(&path)?;
        let genome = Genome::parse(&text)?;
        for case in &genome.evals {
            report.ran += 1;
            let tmp = tempfile::tempdir()?;
            let home = tmp.path().join("home");
            fs::create_dir_all(home.join(".cache"))?;
            fs::write(home.join("notes.txt"), vec![b'a'; 100])?;
            fs::write(home.join(".cache/junk.bin"), vec![b'b'; 4_000])?;
            fs::write(home.join("big.bin"), vec![b'c'; 9_000])?;
            let data = home.join(".xindoze");
            let session = Session::open(offline_config(
                home,
                data,
                text.clone(),
                Arc::new(AlwaysYes),
            ))?;
            let outcome = session.intent(&case.intent).await?;
            if let Err(e) = case.expect.check(&outcome) {
                report.failed += 1;
                report
                    .failures
                    .push(format!("{}: {} — {e}", genome.id, case.intent));
            }
        }
    }
    Ok(report)
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for ent in fs::read_dir(dir)? {
        let ent = ent?;
        let path = ent.path();
        if path.is_dir() {
            collect(&path, out)?;
        } else if path.file_name().and_then(|s| s.to_str()) == Some("GENOME.md") {
            out.push(path);
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EvalReport {
    pub ran: usize,
    pub failed: usize,
    pub failures: Vec<String>,
}

impl EvalReport {
    pub fn ok(&self) -> bool {
        self.failed == 0 && self.ran > 0
    }
}

/// Prints the user-visible answer.
pub fn render(outcome: &Outcome) -> String {
    outcome.say.clone().unwrap_or_else(|| "(no reply)".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn prime_evals_pass_against_the_mock() {
        let root = genomes_root();
        let report = eval_all(&root).await.unwrap();
        assert!(report.ok(), "{report:?}");
    }

    #[test]
    fn prime_text_parses() {
        let g = Genome::parse(&prime_text()).unwrap();
        assert_eq!(g.id, "xindoze.prime");
        assert!(g.evals.len() >= 2);
    }
}
