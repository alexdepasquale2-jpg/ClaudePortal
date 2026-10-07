//! The Organism loop: page context, plan, act, observe, reflect (SPEC §3.8).
//!
//! Crystal check is TODO(phase 3). Until a Crystal matches, every intent
//! takes the fluid path.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::json;
use xz_bridge::{FsOrgan, NetOrgan, ProcOrgan, SysOrgan};
use xz_cortex::generate_json;
use xz_engram::{Engram, Episode};
use xz_genome::{Genome, Observed};
use xz_types::plan::plan_schema;
use xz_types::{
    ChatMessage, Confirmer, GenRequest, Grant, Inference, Outcome, Plan, Result, Risk, StepRecord,
    Taint, Verdict, XzError,
};
use xz_warden::{Charter, Warden};

use crate::organs::{Desk, HiveOrgan, MediaStub, Scheduler};
use crate::pager::page;
use crate::route::route;
use crate::synapse::Synapse;

static TASKS: AtomicU64 = AtomicU64::new(1);

/// What a session needs. Paths are absolute.
pub struct SessionConfig {
    pub home: PathBuf,
    pub data_dir: PathBuf,
    pub device_id: String,
    /// Seed Bank first, then the user's installed genomes.
    pub genome_dirs: Vec<PathBuf>,
    pub inference: Arc<dyn Inference>,
    pub confirmer: Arc<dyn Confirmer>,
    /// Context pager budget. 3000 is a small window and still holds a plan.
    pub token_budget: usize,
}

/// One running mind: Organs, Warden, Engram and the planner.
pub struct Session {
    home: PathBuf,
    genomes: Vec<Genome>,
    inference: Arc<dyn Inference>,
    synapse: Synapse,
    engram: Arc<Engram>,
    warden: Arc<Warden>,
    token_budget: usize,
}

impl Session {
    /// Opens the Engram, loads genomes and mounts the core Organs.
    pub fn open(cfg: SessionConfig) -> Result<Self> {
        if !cfg.home.is_absolute() {
            return Err(XzError::InvalidArgs("home must be absolute".into()));
        }
        std::fs::create_dir_all(&cfg.data_dir)?;
        let engram = Arc::new(Engram::open(&cfg.data_dir, &cfg.device_id)?);
        let charter_path = cfg.data_dir.join("charter.toml");
        let charter = Charter::load(&charter_path)?;
        let warden = Arc::new(Warden::new(
            charter,
            cfg.home.clone(),
            cfg.data_dir.clone(),
        )?);
        let user_genomes = cfg.data_dir.join("genomes");
        let desk = Arc::new(Desk::new(
            engram.clone(),
            warden.clone(),
            charter_path,
            user_genomes,
        ));
        let organs: Vec<Arc<dyn xz_types::Organ>> = vec![
            Arc::new(FsOrgan::new(cfg.home.clone(), cfg.data_dir.clone())),
            Arc::new(ProcOrgan::new(cfg.home.clone(), cfg.data_dir.clone()).without_open()),
            Arc::new(NetOrgan::new()),
            Arc::new(SysOrgan::new()),
            desk,
            Arc::new(Scheduler::new(engram.clone())),
            Arc::new(HiveOrgan::new(&cfg.device_id)),
            Arc::new(MediaStub),
        ];
        let synapse = Synapse::new(organs, warden.clone(), engram.clone(), cfg.confirmer);
        let mut genomes = Vec::new();
        for dir in &cfg.genome_dirs {
            for (path, parsed) in xz_genome::load_dir(dir) {
                genomes
                    .push(parsed.map_err(|e| XzError::Parse(format!("{}: {e}", path.display())))?);
            }
        }
        if genomes.is_empty() {
            return Err(XzError::NotFound("no genomes installed".into()));
        }
        Ok(Self {
            home: cfg.home,
            genomes,
            inference: cfg.inference,
            synapse,
            engram,
            warden,
            token_budget: cfg.token_budget,
        })
    }

    /// The memory this session journals into.
    pub fn engram(&self) -> &Engram {
        &self.engram
    }

    /// The Warden enforcing the Charter, including rules added this session.
    pub fn warden(&self) -> &Warden {
        &self.warden
    }

    /// Recent journal rows, newest last.
    pub fn journal(&self, limit: usize) -> Result<Vec<xz_types::JournalEvent>> {
        let mut events = self.engram.events(&xz_engram::EventQuery {
            limit,
            include_rewound: true,
            ..xz_engram::EventQuery::default()
        })?;
        events.reverse();
        Ok(events)
    }

    /// What Darwin's eval matcher sees in a finished run.
    pub fn observe(&self, outcome: &Outcome) -> Observed {
        let risks: Vec<(String, Risk)> = self
            .synapse
            .tools()
            .into_iter()
            .map(|spec| (spec.name.clone(), spec.effective_risk()))
            .collect();
        Observed {
            tools_called: outcome
                .steps
                .iter()
                .map(|step| (step.tool.clone(), step.args.clone()))
                .collect(),
            ui: outcome.ui.clone(),
            say: outcome.say.clone(),
            state_changed: changed_state(&outcome.steps, |tool| {
                risks
                    .iter()
                    .find(|(name, _)| name == tool)
                    .map(|(_, risk)| *risk)
                    .unwrap_or(Risk::Commit)
            }),
        }
    }

    /// Routes `intent` to an Organism and runs it.
    pub async fn handle(&self, intent: &str) -> Result<Outcome> {
        let genome = route(intent, &self.genomes)?.clone();
        self.run(&genome, intent).await
    }

    /// Runs `intent` as `genome`, which is how evals score one Organism.
    pub async fn handle_genome(&self, genome: &Genome, intent: &str) -> Result<Outcome> {
        self.run(genome, intent).await
    }

    async fn run(&self, genome: &Genome, intent: &str) -> Result<Outcome> {
        let task_id = format!("t{}", TASKS.fetch_add(1, Ordering::Relaxed));
        let tool_names = self.advertised(&genome.capabilities);
        let schema = plan_schema(&tool_names);
        let limit = self.warden.charter().budgets.steps_per_task as usize;
        let mut notes = Vec::new();
        let mut steps = Vec::new();
        let mut say = None;
        let mut ui = None;
        let mut done = false;
        let mut used = 0usize;

        for _round in 0..(limit + 2) {
            let system = format!(
                "Genome: {}\nHome: {}\n\n{}",
                genome.id,
                self.home.display(),
                genome.system_prompt()
            );
            let paged = page(self.token_budget, &system, &[], &notes);
            self.remember_dropped(&task_id, &genome.id, &paged.dropped)?;
            let mut messages = vec![ChatMessage::system(paged.sections[0].clone())];
            messages.push(ChatMessage::user(intent));
            for note in paged.sections.iter().skip(1) {
                messages.push(ChatMessage::user(note.clone()));
            }
            let (value, _) = match generate_json(
                self.inference.as_ref(),
                GenRequest::new(genome.tier, messages).with_schema(schema.clone()),
            )
            .await
            {
                Ok(pair) => pair,
                Err(e) => {
                    say = Some(format!("I couldn't form a plan: {e}"));
                    done = true;
                    break;
                }
            };
            let plan: Plan = serde_json::from_value(value)?;
            say = plan.say.or(say);
            ui = plan.ui.or(ui);
            if plan.steps.is_empty() {
                done = true;
                break;
            }
            if used + plan.steps.len() > limit {
                say = Some(format!("Stopped: this task is limited to {limit} steps."));
                done = false;
                break;
            }
            for step in plan.steps {
                used += 1;
                let result = self
                    .synapse
                    .act(
                        &genome.id,
                        &task_id,
                        &genome.capabilities,
                        &step.tool,
                        step.args.clone(),
                        &Taint::none(),
                    )
                    .await?;
                let body = result
                    .output
                    .as_ref()
                    .map(|o| o.content.clone())
                    .unwrap_or_else(|| json!({"error": result.summary}));
                notes.push(format!("UNTRUSTED DATA\ntool: {}\n{}", result.tool, body));
                steps.push(StepRecord {
                    tool: result.tool,
                    args: result.args,
                    verdict: result.verdict,
                    ok: result.ok,
                    summary: result.summary,
                });
            }
            if plan.done {
                done = true;
                break;
            }
        }

        Ok(Outcome {
            task_id,
            organism: genome.id.clone(),
            say,
            ui,
            steps,
            crystal: None,
            done,
        })
    }

    fn advertised(&self, grants: &[Grant]) -> Vec<String> {
        self.synapse
            .tools()
            .into_iter()
            .map(|spec| spec.name)
            .filter(|name| grants.iter().any(|g| grant_matches(&g.tool, name)))
            .collect()
    }

    fn remember_dropped(&self, task_id: &str, organism: &str, dropped: &[String]) -> Result<()> {
        if dropped.is_empty() {
            return Ok(());
        }
        let summary: String = dropped.join(" ").chars().take(240).collect();
        self.engram.add_episode(&Episode {
            task_id: task_id.into(),
            organism: organism.into(),
            summary,
            ts_ms: xz_types::now_ms(),
        })?;
        Ok(())
    }
}

fn grant_matches(glob: &str, tool: &str) -> bool {
    match glob.strip_suffix('*') {
        Some(prefix) => tool.starts_with(prefix),
        None => glob == tool,
    }
}

/// Whether the run changed state. Observe calls and refusals do not.
pub fn changed_state(steps: &[StepRecord], risk_of: impl Fn(&str) -> Risk) -> bool {
    steps.iter().any(|step| {
        step.ok
            && matches!(step.verdict, Verdict::Allowed | Verdict::Confirmed)
            && risk_of(&step.tool) >= Risk::Act
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use xz_cortex::Cortex;
    use xz_engram::RewindSelector;
    use xz_types::{AlwaysYes, Risk, ToolSpec};
    use xz_warden::Request;

    use crate::reflex::OfflineReflex;

    fn session(home: &std::path::Path) -> Session {
        let data = home.join(".xindoze");
        let genomes = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../genomes");
        Session::open(SessionConfig {
            home: home.to_path_buf(),
            data_dir: data,
            device_id: "local".into(),
            genome_dirs: vec![genomes],
            inference: Arc::new(Cortex::single(Arc::new(OfflineReflex), "offline")),
            confirmer: Arc::new(AlwaysYes),
            token_budget: 3000,
        })
        .unwrap()
    }

    #[tokio::test]
    async fn largest_files_are_ranked_and_journaled() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(home.join("docs")).unwrap();
        std::fs::create_dir_all(home.join("cache")).unwrap();
        std::fs::write(home.join("docs/big.bin"), vec![1; 9000]).unwrap();
        std::fs::write(home.join("cache/junk.bin"), vec![1; 4000]).unwrap();
        std::fs::write(home.join("app.log"), vec![1; 2000]).unwrap();
        std::fs::write(home.join("docs/photo.jpg"), vec![1; 800]).unwrap();
        std::fs::write(home.join("docs/notes.txt"), vec![1; 100]).unwrap();
        let session = session(&home);
        let outcome = session
            .handle("find my 10 largest files and tell me which look safe to delete")
            .await
            .unwrap();
        let say = outcome.say.unwrap();
        assert!(say.contains("big.bin") && say.contains("keep"), "{say}");
        assert!(
            say.contains("junk.bin") && say.contains("looks safe to delete"),
            "{say}"
        );
        assert!(
            say.contains("app.log") && say.contains("looks safe to delete"),
            "{say}"
        );
        assert!(outcome.ui.unwrap().contains_type("table"));
        let events = session
            .engram()
            .events(&xz_engram::EventQuery {
                task_id: Some(outcome.task_id),
                ..xz_engram::EventQuery::default()
            })
            .unwrap();
        assert!(events.iter().any(|ev| ev.tool == "fs.search" && ev.ok));
    }

    #[tokio::test]
    async fn taxes_move_is_journaled_and_rewinds() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(home.join("invoice.pdf"), "invoice for services\n").unwrap();
        std::fs::write(home.join("other.pdf"), "recipe\n").unwrap();
        let session = session(&home);
        let outcome = session
            .handle("Make a folder Taxes 2026 and move every PDF mentioning 'invoice' into it")
            .await
            .unwrap();
        let dest = home.join("Taxes 2026/invoice.pdf");
        assert!(dest.is_file(), "missing {dest:?}");
        assert!(!home.join("invoice.pdf").exists());
        assert!(home.join("other.pdf").is_file());
        let report = session
            .engram()
            .rewind(&RewindSelector::Task(outcome.task_id))
            .unwrap();
        assert!(!report.events.is_empty(), "{report:?}");
        assert!(
            home.join("invoice.pdf").is_file(),
            "rewind did not restore the pdf"
        );
    }

    #[tokio::test]
    async fn charter_rule_holds_a_later_send() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        let session = session(&home);
        let files = session
            .genomes
            .iter()
            .find(|g| g.id == "xindoze.charter")
            .unwrap()
            .clone();
        let outcome = session
            .handle_genome(&files, "Never send messages without asking me")
            .await
            .unwrap();
        assert!(
            outcome
                .steps
                .iter()
                .any(|s| s.tool == "xz.charter_add_rule" && s.ok),
            "{outcome:?}"
        );
        let spec = ToolSpec {
            name: "people.message_send".into(),
            description: "send".into(),
            input_schema: json!({}),
            risk: Risk::Commit,
            resource_args: vec![],
            tainted_output: false,
            first_party: true,
        };
        let grants = [Grant {
            tool: "people.message_send".into(),
            resources: vec![],
        }];
        let args = json!({"to": "sam", "text": "hi"});
        let decision = session.warden().decide(&Request {
            organism: "xindoze.notes",
            grants: &grants,
            spec: &spec,
            args: &args,
            taint: &Taint::none(),
        });
        assert!(
            matches!(decision, xz_types::Decision::Ask { .. }),
            "{decision:?}"
        );
    }

    #[tokio::test]
    async fn seed_bank_evals_pass() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(home.join("Downloads")).unwrap();
        std::fs::write(home.join("invoice.pdf"), "invoice\n").unwrap();
        let session = session(&home);
        let mut failed = Vec::new();
        for genome in &session.genomes {
            for eval in &genome.evals {
                let outcome = session.handle_genome(genome, &eval.intent).await.unwrap();
                let obs = session.observe(&outcome);
                if let Err(e) = eval.expect.check(&obs) {
                    failed.push(format!("{} / {}: {e}", genome.id, eval.intent));
                }
            }
        }
        assert!(failed.is_empty(), "{}", failed.join("\n"));
    }

    #[tokio::test]
    async fn a_hard_question_runs_here_when_the_pc_is_offline() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        let session = session(&home);
        let hive = session
            .genomes
            .iter()
            .find(|g| g.id == "xindoze.hive")
            .unwrap()
            .clone();
        let outcome = session
            .handle_genome(
                &hive,
                "answer this on my PC: explain how vaccines train the immune system",
            )
            .await
            .unwrap();
        assert!(
            outcome
                .steps
                .iter()
                .any(|step| step.tool == "hive.run_on" && step.ok),
            "{outcome:?}"
        );
        let say = outcome.say.unwrap_or_default();
        assert_eq!(say, xz_hive::LOCAL_NOTICE);
        assert_eq!(say.lines().count(), 1);
    }
}
