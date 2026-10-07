//! xinod daemon and the `xz` Intent Bar.
//!
//! With no `XZ_MODEL`, planning uses the offline reflex. Set `XZ_MODEL` to
//! an Ollama model name to plan with a local model instead.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use xz_core::{OfflineReflex, Session, SessionConfig};
use xz_cortex::{Cortex, OllamaBackend};
use xz_types::{AlwaysNo, AlwaysYes, Confirmer, Inference, Result, StepRecord, Verdict, XzError};

/// How many seed evals ran, and which ones missed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EvalReport {
    pub ran: usize,
    pub failed: Vec<String>,
}

/// Opens a session for `home`. Genomes come from `XZ_GENOMES` or the Seed Bank
/// next to this crate, then from `<data>/genomes`.
pub fn open_session(home: &Path, confirmer: Arc<dyn Confirmer>) -> Result<Session> {
    if !home.is_absolute() {
        return Err(XzError::InvalidArgs("home must be absolute".into()));
    }
    let data = data_dir(home);
    let mut genome_dirs = vec![genomes_root()];
    genome_dirs.push(data.join("genomes"));
    Session::open(SessionConfig {
        home: home.to_path_buf(),
        data_dir: data,
        device_id: "local".into(),
        genome_dirs,
        inference: inference()?,
        confirmer,
        token_budget: prompt_budget(),
    })
}

/// Loads the Ollama model and holds it for [`OllamaBackend::KEEP_ALIVE`].
///
/// The warm-up call uses the same `num_ctx` as later plans. A miss here does
/// not stop the Intent Bar; the next request reports the model error.
pub async fn warm_planner() {
    let Ok(model) = std::env::var("XZ_MODEL") else {
        return;
    };
    let model = model.trim();
    if model.is_empty() {
        return;
    }
    let url = std::env::var("XZ_OLLAMA").unwrap_or_else(|_| "http://127.0.0.1:11434".into());
    let backend = match OllamaBackend::new(url) {
        Ok(backend) => backend.with_context(OllamaBackend::context_from_env()),
        Err(err) => {
            eprintln!("xinod: model warm-up skipped: {err}");
            return;
        }
    };
    if let Err(err) = backend.warm(model).await {
        eprintln!("xinod: model warm-up skipped: {err}");
    }
}

fn prompt_budget() -> usize {
    if std::env::var("XZ_MODEL")
        .ok()
        .is_some_and(|model| !model.trim().is_empty())
    {
        let ctx = OllamaBackend::context_from_env();
        // Leave the default completion (1024) inside num_ctx so Ollama does
        // not drop the system prompt to make room.
        usize::try_from(ctx.saturating_sub(1024).max(1024)).unwrap_or(1024)
    } else {
        3000
    }
}

/// Runs every eval of every genome under `dir` against a throwaway home.
pub async fn eval_all(dir: &Path) -> Result<EvalReport> {
    let home = std::env::temp_dir().join(format!("xz-eval-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join("Downloads"))?;
    std::fs::write(home.join("invoice.pdf"), "invoice\n")?;
    let session = Session::open(SessionConfig {
        home: home.clone(),
        data_dir: home.join(".xindoze"),
        device_id: "eval".into(),
        genome_dirs: vec![dir.to_path_buf()],
        inference: Arc::new(Cortex::single(Arc::new(OfflineReflex), "offline")),
        confirmer: Arc::new(AlwaysYes),
        token_budget: 3000,
    })?;
    let mut report = EvalReport::default();
    for (path, parsed) in xz_genome::load_dir(dir) {
        let genome = parsed.map_err(|e| XzError::Parse(format!("{}: {e}", path.display())))?;
        for eval in &genome.evals {
            report.ran += 1;
            let outcome = session.handle_genome(&genome, &eval.intent).await?;
            let obs = session.observe(&outcome);
            if let Err(e) = eval.expect.check(&obs) {
                report
                    .failed
                    .push(format!("{}: {} — {e}", genome.id, eval.intent));
            }
        }
    }
    let _ = std::fs::remove_dir_all(&home);
    Ok(report)
}

/// Renders an outcome as a few lines for the terminal.
pub fn render(outcome: &xz_types::Outcome) -> String {
    let mut lines = Vec::new();
    if let Some(id) = &outcome.crystal {
        lines.push(format!("crystal {id}"));
    }
    if let Some(say) = &outcome.say {
        lines.push(say.clone());
    }
    for step in &outcome.steps {
        let mark = if step.ok { "ok" } else { "failed" };
        lines.push(format!("{mark} {} {}", step.verdict_word(), step.tool));
    }
    if lines.is_empty() {
        lines.push("(no reply)".into());
    }
    lines.join("\n")
}

trait VerdictWord {
    fn verdict_word(&self) -> &'static str;
}

impl VerdictWord for StepRecord {
    fn verdict_word(&self) -> &'static str {
        match self.verdict {
            Verdict::Allowed => "allowed",
            Verdict::Confirmed => "confirmed",
            Verdict::Declined => "declined",
            Verdict::Denied => "denied",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_names_the_crystal() {
        let outcome = xz_types::Outcome {
            task_id: "t".into(),
            organism: "xindoze.hive".into(),
            say: Some("hi".into()),
            ui: None,
            steps: vec![],
            crystal: Some("xtal".into()),
            done: true,
        };
        let text = render(&outcome);
        assert!(text.starts_with("crystal xtal\nhi"), "{text}");
    }
}

/// Home directory: `XZ_HOME`, otherwise the process home.
pub fn home_dir() -> Result<PathBuf> {
    if let Ok(home) = std::env::var("XZ_HOME") {
        return Ok(PathBuf::from(home));
    }
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| XzError::InvalidArgs("set XZ_HOME or HOME".into()))
}

/// Data directory: `XZ_DATA`, otherwise `<home>/.xindoze`.
pub fn data_dir(home: &Path) -> PathBuf {
    std::env::var("XZ_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join(".xindoze"))
}

/// Seed Bank directory: `XZ_GENOMES`, otherwise the genomes shipped with xinod.
pub fn genomes_root() -> PathBuf {
    std::env::var("XZ_GENOMES")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../genomes"))
}

fn inference() -> Result<Arc<dyn Inference>> {
    if let Ok(model) = std::env::var("XZ_MODEL") {
        if !model.trim().is_empty() {
            let url =
                std::env::var("XZ_OLLAMA").unwrap_or_else(|_| "http://127.0.0.1:11434".into());
            let backend = OllamaBackend::new(url)?.with_context(OllamaBackend::context_from_env());
            return Ok(Arc::new(Cortex::single(Arc::new(backend), &model)));
        }
    }
    Ok(Arc::new(Cortex::single(Arc::new(OfflineReflex), "offline")))
}

/// Confirmer for a terminal: `XZ_YES=1` accepts, otherwise decline.
///
/// A real prompt needs a person. Non-interactive runs decline commit calls
/// so a script cannot confirm them by accident.
pub fn confirmer() -> Arc<dyn Confirmer> {
    if std::env::var("XZ_YES").ok().as_deref() == Some("1") {
        Arc::new(AlwaysYes)
    } else {
        Arc::new(AlwaysNo)
    }
}
