//! Canvas adapter over the existing `xinod` session.
//!
//! Intents, the Journal, Rewind, the Charter and blobs are the real runtime.
//! Direct button tool-calls go through that same session and only succeed
//! when the named tool actually ran.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::broadcast;
use xz_engram::RewindSelector;
use xz_genome::Ui;
use xz_types::{JournalEvent, Outcome, Role, Verdict, XzError};
use xz_warden::Policy;

use crate::ask::{AskHub, CanvasConfirmer};
use crate::runtime::{
    CharterRule, CharterView, EgressEvent, GenomeInfo, ModelStatus, Pulse, RewindReport,
    RuleDecision, ShellRuntime, StepEvent, ToolReply,
};

pub struct CoreRuntime {
    session: xz_core::Session,
    hub: Arc<AskHub>,
    steps: broadcast::Sender<StepEvent>,
    requests: AtomicU64,
    genome_dirs: Vec<PathBuf>,
    model: String,
    backend: String,
}

impl CoreRuntime {
    pub fn open(app: AppHandle) -> Result<Self, XzError> {
        let home = xinod::home_dir()?;
        let hub = Arc::new(AskHub::new(app));
        let session = xinod::open_session(
            &home,
            Arc::new(CanvasConfirmer { hub: hub.clone() }),
        )?;
        let (model, backend) = match std::env::var("XZ_MODEL") {
            Ok(model) if !model.trim().is_empty() => (model, "ollama".into()),
            _ => ("offline-reflex".into(), "offline".into()),
        };
        let (steps, _) = broadcast::channel(64);
        let data = xinod::data_dir(&home);
        Ok(Self {
            session,
            hub,
            steps,
            requests: AtomicU64::new(0),
            genome_dirs: vec![xinod::genomes_root(), data.join("genomes")],
            model,
            backend,
        })
    }

    fn load_genomes(&self) -> Vec<xz_genome::Genome> {
        let mut out = Vec::new();
        for dir in &self.genome_dirs {
            for (_path, parsed) in xz_genome::load_dir(dir) {
                let Ok(genome) = parsed else { continue };
                if out.iter().any(|have: &xz_genome::Genome| have.id == genome.id) {
                    continue;
                }
                out.push(genome);
            }
        }
        out
    }

    fn note_steps(&self, outcome: &Outcome) {
        for step in &outcome.steps {
            let _ = self.steps.send(StepEvent {
                task_id: outcome.task_id.clone(),
                step: step.clone(),
            });
        }
    }
}

#[async_trait]
impl ShellRuntime for CoreRuntime {
    async fn intent(&self, text: &str) -> Result<Outcome, XzError> {
        self.requests.fetch_add(1, Ordering::Relaxed);
        let outcome = self.session.handle(text).await?;
        self.note_steps(&outcome);
        Ok(outcome)
    }

    async fn intent_for(&self, organism: &str, text: &str) -> Result<Outcome, XzError> {
        self.requests.fetch_add(1, Ordering::Relaxed);
        let genome = self
            .load_genomes()
            .into_iter()
            .find(|genome| genome.id == organism)
            .ok_or_else(|| XzError::NotFound(format!("no genome {organism}")))?;
        let outcome = self.session.handle_genome(&genome, text).await?;
        self.note_steps(&outcome);
        Ok(outcome)
    }

    async fn tool_call(
        &self,
        organism: &str,
        tool: &str,
        args: Value,
    ) -> Result<ToolReply, XzError> {
        let text = format!("Call `{tool}` with arguments {args}. Do not call any other tool.");
        let outcome = self.intent_for(organism, &text).await?;
        let step = outcome
            .steps
            .iter()
            .rev()
            .find(|step| step.tool == tool && step.ok);
        match step {
            Some(step) => Ok(ToolReply {
                content: Value::String(step.summary.clone()),
            }),
            None => Err(XzError::Unsupported(format!(
                "stub: Session has no direct tool call, and `{tool}` did not run"
            ))),
        }
    }

    async fn rewind(&self, task_id: &str) -> Result<RewindReport, XzError> {
        let report = self
            .session
            .engram()
            .rewind(&RewindSelector::Task(task_id.to_string()))?;
        Ok(RewindReport {
            undone: report.undone.iter().map(line).collect(),
            skipped: report.skipped.iter().map(line).collect(),
            failed: report.failed.iter().map(line).collect(),
        })
    }

    async fn pulse(&self) -> Result<Pulse, XzError> {
        let events = self.journal(200).await?;
        let journal_count = self
            .session
            .engram()
            .last_seq("local")
            .unwrap_or(events.len() as i64)
            .max(0) as u64;
        Ok(Pulse {
            host: host_label(),
            tier: if self.backend == "ollama" {
                "desktop".into()
            } else {
                "offline".into()
            },
            models: vec![ModelStatus {
                role: Role::Reflex,
                model: self.model.clone(),
                backend: self.backend.clone(),
                loaded: true,
            }],
            tokens_per_sec: 0.0,
            requests: self.requests.load(Ordering::Relaxed),
            peers: Vec::new(),
            egress: egress_from(&events),
            journal_count,
        })
    }

    async fn genomes(&self) -> Result<Vec<GenomeInfo>, XzError> {
        Ok(self
            .load_genomes()
            .into_iter()
            .map(|genome| GenomeInfo {
                id: genome.id,
                version: genome.version,
                purpose: genome.purpose,
                ui: match genome.ui {
                    Ui::Canvas => "canvas".into(),
                    Ui::None => "none".into(),
                },
            })
            .collect())
    }

    async fn journal(&self, limit: usize) -> Result<Vec<JournalEvent>, XzError> {
        let mut events = self.session.journal(limit)?;
        events.reverse();
        Ok(events)
    }

    async fn charter(&self) -> Result<CharterView, XzError> {
        let charter = self.session.warden().charter();
        Ok(CharterView {
            rules: charter
                .rules
                .into_iter()
                .map(|rule| {
                    let text = if rule.text.trim().is_empty() {
                        rule.describe()
                    } else {
                        rule.text.clone()
                    };
                    CharterRule {
                        id: rule.id,
                        text,
                        decision: match rule.decision {
                            Policy::Allow => RuleDecision::Allow,
                            Policy::Ask => RuleDecision::Ask,
                            Policy::Deny => RuleDecision::Deny,
                        },
                    }
                })
                .collect(),
        })
    }

    async fn confirm_reply(&self, id: &str, approve: bool) -> Result<(), XzError> {
        if self.hub.reply(id, approve) {
            Ok(())
        } else {
            Err(XzError::NotFound(format!("no pending ask {id}")))
        }
    }

    async fn blob(&self, reference: &str) -> Result<String, XzError> {
        if !is_sha256(reference) {
            return Ok(String::new());
        }
        let bytes = match self.session.engram().get_blob(reference) {
            Ok(bytes) => bytes,
            Err(XzError::NotFound(_)) => return Ok(String::new()),
            Err(err) => return Err(err),
        };
        let Some(mime) = image_mime(&bytes) else {
            return Ok(String::new());
        };
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        Ok(format!("data:{mime};base64,{encoded}"))
    }

    fn subscribe_steps(&self) -> broadcast::Receiver<StepEvent> {
        self.steps.subscribe()
    }
}

fn line(item: &xz_engram::RewindItem) -> String {
    let why = if item.reason.is_empty() {
        String::new()
    } else {
        format!(" ({})", item.reason)
    };
    format!("{} {why}", item.tool)
}

fn host_label() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    format!("{os}/{arch}")
}

pub fn egress_from(events: &[JournalEvent]) -> Vec<EgressEvent> {
    events
        .iter()
        .filter(|event| event.tool.starts_with("net."))
        .map(|event| EgressEvent {
            host: host_of_args(&event.args).unwrap_or_else(|| event.tool.clone()),
            ts_ms: event.ts_ms,
            allowed: event.ok && matches!(event.verdict, Verdict::Allowed | Verdict::Confirmed),
        })
        .collect()
}

fn host_of_args(args: &Value) -> Option<String> {
    let url = args.get("url").and_then(Value::as_str)?;
    host_of_url(url)
}

pub fn host_of_url(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let host = host.rsplit('@').next().unwrap_or(host);
    let host = host.split(':').next().unwrap_or(host);
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

pub fn open_http(url: &str) -> Result<(), XzError> {
    let url = url.trim();
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(XzError::InvalidArgs("url has whitespace or control characters".into()));
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(XzError::InvalidArgs("only http(s) links open outside the Canvas".into()));
    }
    #[cfg(not(target_os = "android"))]
    {
        open::that(url).map_err(|err| XzError::Other(err.to_string()))?;
        Ok(())
    }
    #[cfg(target_os = "android")]
    {
        let _ = url;
        Err(XzError::Unsupported("open_url on Android is owned by the Android bridge".into()))
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else {
        None
    }
}

#[allow(dead_code)]
fn _json_host_smoke() -> Option<String> {
    host_of_args(&json!({"url": "https://example.com/a"}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_and_host_sniff() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(image_mime(b"<svg></svg>"), None);
        assert_eq!(host_of_url("https://user:pw@files.example:8443/a"), Some("files.example".into()));
        assert!(open_http("file:///etc/passwd").is_err());
        assert!(open_http("https://example.com/ok path").is_err());
    }

    #[tokio::test]
    async fn session_opens_on_the_seed_bank() {
        let home = tempfile::tempdir().unwrap();
        let session = xinod::open_session(home.path(), Arc::new(xz_types::AlwaysNo)).unwrap();
        let outcome = session
            .handle("find my 10 largest files and tell me which look safe to delete")
            .await
            .unwrap();
        assert!(!outcome.task_id.is_empty());
    }
}
