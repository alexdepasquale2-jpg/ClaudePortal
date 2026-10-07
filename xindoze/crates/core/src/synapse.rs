//! Synapse: the only path from an Organism to an Organ (SPEC §3.3).

use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;
use xz_engram::Engram;
use xz_types::{
    AskInfo, CallCtx, Confirmer, Decision, Effect, Grant, JournalEvent, Organ, Result, Risk,
    Snapshotter, Taint, ToolOutput, ToolSpec, Verdict, XzError, now_ms,
};
use xz_warden::{Request, Warden};

/// What one tool call did, after the Warden and the Journal.
#[derive(Clone, Debug)]
pub struct ActResult {
    pub tool: String,
    pub args: Value,
    pub verdict: Verdict,
    pub risk: Risk,
    pub ok: bool,
    pub summary: String,
    pub output: ToolOutput,
}

/// In-process MCP router. Third-party stdio mounts are TODO(phase 1).
pub struct Synapse {
    organs: HashMap<String, Arc<dyn Organ>>,
    specs: HashMap<String, ToolSpec>,
    warden: Arc<Warden>,
    engram: Arc<Engram>,
    confirmer: Arc<dyn Confirmer>,
    snapshot: Arc<dyn Snapshotter>,
}

impl Synapse {
    pub fn new(
        organs: Vec<Arc<dyn Organ>>,
        warden: Arc<Warden>,
        engram: Arc<Engram>,
        confirmer: Arc<dyn Confirmer>,
        snapshot: Arc<dyn Snapshotter>,
    ) -> Result<Self> {
        let mut by_family = HashMap::new();
        let mut specs = HashMap::new();
        for organ in organs {
            let family = organ.family().to_string();
            for spec in organ.tools() {
                if specs.insert(spec.name.clone(), spec).is_some() {
                    return Err(XzError::InvalidArgs(format!(
                        "duplicate tool in family {family}"
                    )));
                }
            }
            by_family.insert(family, organ);
        }
        Ok(Self {
            organs: by_family,
            specs,
            warden,
            engram,
            confirmer,
            snapshot,
        })
    }

    pub fn tools(&self) -> Vec<ToolSpec> {
        let mut tools: Vec<_> = self.specs.values().cloned().collect();
        tools.sort_by(|a, b| a.name.cmp(&b.name));
        tools
    }

    /// Decides, confirms, calls, and journals. A denial is a result, not a
    /// crash: the planner sees it and must not claim the action happened.
    pub async fn call(
        &self,
        organism: &str,
        task_id: &str,
        grants: &[Grant],
        tool: &str,
        args: Value,
        taint: &Taint,
    ) -> Result<ActResult> {
        let Some(spec) = self.specs.get(tool) else {
            let summary = format!("unknown tool {tool}");
            self.journal(&Row {
                organism,
                task_id,
                tool,
                args: &args,
                risk: Risk::Commit,
                verdict: Verdict::Denied,
                taint,
                ok: false,
                summary: &summary,
                effects: &[],
            })?;
            return Ok(denied(tool, args, Risk::Commit, summary));
        };
        let risk = spec.effective_risk();
        let decision = self.warden.decide(&Request {
            organism,
            grants,
            spec,
            args: &args,
            taint,
        });
        let verdict = match decision {
            Decision::Deny { reason } => {
                self.journal(&Row {
                    organism,
                    task_id,
                    tool,
                    args: &args,
                    risk,
                    verdict: Verdict::Denied,
                    taint,
                    ok: false,
                    summary: &reason,
                    effects: &[],
                })?;
                return Ok(denied(tool, args, risk, reason));
            }
            Decision::Ask { reason } => {
                let yes = self
                    .confirmer
                    .confirm(&AskInfo {
                        organism: organism.into(),
                        tool: tool.into(),
                        args: args.clone(),
                        risk,
                        reason: reason.clone(),
                        taint: taint.clone(),
                    })
                    .await;
                if !yes {
                    let summary = format!("declined: {reason}");
                    self.journal(&Row {
                        organism,
                        task_id,
                        tool,
                        args: &args,
                        risk,
                        verdict: Verdict::Declined,
                        taint,
                        ok: false,
                        summary: &summary,
                        effects: &[],
                    })?;
                    return Ok(ActResult {
                        tool: tool.into(),
                        args,
                        verdict: Verdict::Declined,
                        risk,
                        ok: false,
                        summary,
                        output: ToolOutput::clean(json!({"declined": true})),
                    });
                }
                Verdict::Confirmed
            }
            Decision::Allow => Verdict::Allowed,
        };

        let family = tool.split('.').next().unwrap_or("");
        let Some(organ) = self.organs.get(family) else {
            let summary = format!("no organ for {tool}");
            self.journal(&Row {
                organism,
                task_id,
                tool,
                args: &args,
                risk,
                verdict: Verdict::Denied,
                taint,
                ok: false,
                summary: &summary,
                effects: &[],
            })?;
            return Ok(denied(tool, args, risk, summary));
        };
        let ctx = CallCtx {
            organism: organism.into(),
            task_id: task_id.into(),
            snapshot: self.snapshot.clone(),
        };
        match organ.call(&ctx, tool, args.clone()).await {
            Ok(output) => {
                let mut recorded = taint.clone();
                recorded.merge(&output.taint);
                let summary = summarize(tool, &output.content);
                self.journal(&Row {
                    organism,
                    task_id,
                    tool,
                    args: &args,
                    risk,
                    verdict,
                    taint: &recorded,
                    ok: true,
                    summary: &summary,
                    effects: &output.effects,
                })?;
                Ok(ActResult {
                    tool: tool.into(),
                    args,
                    verdict,
                    risk,
                    ok: true,
                    summary,
                    output,
                })
            }
            Err(e) => {
                let summary = e.to_string();
                self.journal(&Row {
                    organism,
                    task_id,
                    tool,
                    args: &args,
                    risk,
                    verdict,
                    taint,
                    ok: false,
                    summary: &summary,
                    effects: &[],
                })?;
                Ok(ActResult {
                    tool: tool.into(),
                    args,
                    verdict,
                    risk,
                    ok: false,
                    summary: summary.clone(),
                    output: ToolOutput::clean(json!({"error": summary})),
                })
            }
        }
    }

    fn journal(&self, row: &Row<'_>) -> Result<()> {
        self.engram.append(&JournalEvent {
            seq: 0,
            device: String::new(),
            ts_ms: now_ms(),
            organism: row.organism.into(),
            task_id: row.task_id.into(),
            tool: row.tool.into(),
            args: row.args.clone(),
            risk: row.risk,
            verdict: row.verdict,
            taint: row.taint.clone(),
            ok: row.ok,
            summary: clip(row.summary, 400),
            effects: row.effects.to_vec(),
            rewound: false,
        })?;
        Ok(())
    }
}

struct Row<'a> {
    organism: &'a str,
    task_id: &'a str,
    tool: &'a str,
    args: &'a Value,
    risk: Risk,
    verdict: Verdict,
    taint: &'a Taint,
    ok: bool,
    summary: &'a str,
    effects: &'a [Effect],
}

fn denied(tool: &str, args: Value, risk: Risk, summary: String) -> ActResult {
    ActResult {
        tool: tool.into(),
        args,
        verdict: Verdict::Denied,
        risk,
        ok: false,
        summary: summary.clone(),
        output: ToolOutput::clean(json!({"denied": summary})),
    }
}

fn summarize(tool: &str, content: &Value) -> String {
    if tool == "fs.search" {
        let n = content["files"].as_array().map(|a| a.len()).unwrap_or(0);
        return format!("found {n} file(s)");
    }
    if tool == "net.fetch" {
        let status = content["status"].as_u64().unwrap_or(0);
        let bytes = content["bytes"].as_u64().unwrap_or(0);
        return format!("fetched status {status}, {bytes} bytes");
    }
    if tool == "proc.list" {
        let n = content["processes"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0);
        return format!("listed {n} processes");
    }
    clip(&content.to_string(), 180)
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let t: String = s.chars().take(max).collect();
    format!("{t}…")
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use xz_types::{AlwaysNo, AlwaysYes, Risk, ToolSpec};
    use xz_warden::Charter;

    struct Echo {
        hits: AtomicUsize,
    }

    #[async_trait]
    impl Organ for Echo {
        fn family(&self) -> &str {
            "net"
        }
        fn tools(&self) -> Vec<ToolSpec> {
            vec![
                ToolSpec {
                    name: "net.fetch".into(),
                    description: "get".into(),
                    input_schema: json!({}),
                    risk: Risk::Observe,
                    resource_args: vec!["url".into()],
                    tainted_output: true,
                    first_party: true,
                },
                ToolSpec {
                    name: "net.post".into(),
                    description: "post".into(),
                    input_schema: json!({}),
                    risk: Risk::Commit,
                    resource_args: vec!["url".into()],
                    tainted_output: false,
                    first_party: true,
                },
            ]
        }
        async fn call(&self, _: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
            self.hits.fetch_add(1, Ordering::SeqCst);
            Ok(ToolOutput::tainted(
                json!({"tool": tool, "args": args}),
                "web:example.com",
            ))
        }
    }

    fn setup(confirmer: Arc<dyn Confirmer>) -> (Synapse, Arc<Echo>, Arc<Engram>) {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        let data = home.join(".xindoze");
        std::fs::create_dir_all(&data).unwrap();
        let engram = Arc::new(Engram::open(&data, "local").unwrap());
        let warden = Arc::new(Warden::new(Charter::default(), home, data).unwrap());
        let echo = Arc::new(Echo {
            hits: AtomicUsize::new(0),
        });
        let snap = Arc::new(xz_types::NoSnapshot);
        let synapse =
            Synapse::new(vec![echo.clone()], warden, engram.clone(), confirmer, snap).unwrap();
        // Keep the temp dir alive by leaking it: Engram's path must stay.
        std::mem::forget(dir);
        (synapse, echo, engram)
    }

    fn grants() -> Vec<Grant> {
        vec![Grant {
            tool: "net.*".into(),
            resources: vec![],
        }]
    }

    #[tokio::test]
    async fn allow_calls_the_organ_and_journals() {
        let (syn, echo, eg) = setup(Arc::new(AlwaysYes));
        let act = syn
            .call(
                "xindoze.prime",
                "t1",
                &grants(),
                "net.fetch",
                json!({"url": "http://127.0.0.1/x"}),
                &Taint::none(),
            )
            .await
            .unwrap();
        assert!(act.ok);
        assert_eq!(act.verdict, Verdict::Allowed);
        assert_eq!(echo.hits.load(Ordering::SeqCst), 1);
        let events = eg.events(&Default::default()).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].tool, "net.fetch");
        assert!(events[0].ok);
        assert!(!events[0].taint.is_clean());
    }

    #[tokio::test]
    async fn unknown_tool_is_journaled_and_not_called() {
        let (syn, echo, eg) = setup(Arc::new(AlwaysYes));
        let act = syn
            .call(
                "xindoze.prime",
                "t1",
                &grants(),
                "fs.trash",
                json!({}),
                &Taint::none(),
            )
            .await
            .unwrap();
        assert!(!act.ok);
        assert_eq!(act.verdict, Verdict::Denied);
        assert_eq!(echo.hits.load(Ordering::SeqCst), 0);
        let events = eg.events(&Default::default()).unwrap();
        assert_eq!(events[0].verdict, Verdict::Denied);
        assert_eq!(events[0].tool, "fs.trash");
    }

    #[tokio::test]
    async fn tainted_commit_asks_and_a_no_does_not_call() {
        let (syn, echo, eg) = setup(Arc::new(AlwaysNo));
        let act = syn
            .call(
                "xindoze.prime",
                "t1",
                &grants(),
                "net.post",
                json!({"url": "https://example.com/x"}),
                &Taint::from_source("web:example.com"),
            )
            .await
            .unwrap();
        assert_eq!(act.verdict, Verdict::Declined);
        assert_eq!(echo.hits.load(Ordering::SeqCst), 0);
        let events = eg.events(&Default::default()).unwrap();
        assert_eq!(events[0].verdict, Verdict::Declined);
        assert!(events[0].summary.contains("tainted") || events[0].summary.contains("commit"));
    }
}
