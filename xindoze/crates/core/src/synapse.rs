//! Synapse: every tool call goes Warden, then Organ, and is journaled
//! (SPEC §3.3).

use std::sync::Arc;

use serde_json::{Value, json};
use xz_engram::{BlobSnapshotter, Engram};
use xz_types::{
    CallCtx, Confirmer, Decision, JournalEvent, Organ, Result, Risk, Taint, ToolOutput, ToolSpec,
    Verdict, XzError,
};
use xz_warden::{Request, Warden};

/// What one attempted call did.
#[derive(Clone, Debug)]
pub struct ActResult {
    pub tool: String,
    pub args: Value,
    pub risk: Risk,
    pub decision: Decision,
    pub verdict: Verdict,
    pub ok: bool,
    pub summary: String,
    pub output: Option<ToolOutput>,
}

/// The bus between Organisms and Organs.
pub struct Synapse {
    organs: Vec<Arc<dyn Organ>>,
    warden: Arc<Warden>,
    engram: Arc<Engram>,
    confirmer: Arc<dyn Confirmer>,
}

impl Synapse {
    /// `organs` are tried in order; the first that advertises `tool` runs it.
    pub fn new(
        organs: Vec<Arc<dyn Organ>>,
        warden: Arc<Warden>,
        engram: Arc<Engram>,
        confirmer: Arc<dyn Confirmer>,
    ) -> Self {
        Self {
            organs,
            warden,
            engram,
            confirmer,
        }
    }

    /// Tool specs advertised by the mounted Organs.
    pub fn tools(&self) -> Vec<ToolSpec> {
        self.organs.iter().flat_map(|o| o.tools()).collect()
    }

    /// Decides, maybe asks, runs, and journals one call.
    pub async fn act(
        &self,
        organism: &str,
        task_id: &str,
        grants: &[xz_types::Grant],
        tool: &str,
        args: Value,
        taint: &Taint,
    ) -> Result<ActResult> {
        let spec = self.lookup(tool);
        let (risk, spec_ref) = match &spec {
            Some(s) => (s.effective_risk(), s),
            None => {
                let fallback = unknown_spec(tool);
                let reason = format!("unknown tool `{tool}`");
                return self
                    .finish(
                        Call {
                            organism,
                            task_id,
                            spec: &fallback,
                            args: &args,
                            taint,
                        },
                        Settled {
                            decision: Decision::Deny {
                                reason: reason.clone(),
                            },
                            verdict: Verdict::Denied,
                            ok: false,
                            summary: reason,
                            output: None,
                        },
                    )
                    .await;
            }
        };
        let decision = self.warden.decide(&Request {
            organism,
            grants,
            spec: spec_ref,
            args: &args,
            taint,
        });
        let call = Call {
            organism,
            task_id,
            spec: spec_ref,
            args: &args,
            taint,
        };
        match decision {
            Decision::Deny { reason } => {
                self.finish(
                    call,
                    Settled {
                        decision: Decision::Deny {
                            reason: reason.clone(),
                        },
                        verdict: Verdict::Denied,
                        ok: false,
                        summary: reason,
                        output: None,
                    },
                )
                .await
            }
            Decision::Ask { reason } => {
                let allow = self
                    .confirmer
                    .confirm(&xz_types::AskInfo {
                        organism: organism.into(),
                        tool: tool.into(),
                        args: args.clone(),
                        risk,
                        reason: reason.clone(),
                        taint: taint.clone(),
                    })
                    .await;
                if !allow {
                    return self
                        .finish(
                            call,
                            Settled {
                                decision: Decision::Ask { reason },
                                verdict: Verdict::Declined,
                                ok: false,
                                summary: "you declined".into(),
                                output: None,
                            },
                        )
                        .await;
                }
                self.run_organ(call, Decision::Ask { reason }, Verdict::Confirmed)
                    .await
            }
            Decision::Allow => {
                self.run_organ(call, Decision::Allow, Verdict::Allowed)
                    .await
            }
        }
    }

    fn lookup(&self, tool: &str) -> Option<ToolSpec> {
        self.organs
            .iter()
            .find_map(|organ| organ.tools().into_iter().find(|spec| spec.name == tool))
    }

    async fn run_organ(
        &self,
        call: Call<'_>,
        decision: Decision,
        verdict: Verdict,
    ) -> Result<ActResult> {
        let ctx = CallCtx {
            organism: call.organism.into(),
            task_id: call.task_id.into(),
            snapshot: Arc::new(BlobSnapshotter(self.engram.clone())),
        };
        let organ = self
            .organs
            .iter()
            .find(|organ| organ.tools().iter().any(|s| s.name == call.spec.name));
        let ran = match organ {
            Some(organ) => organ.call(&ctx, &call.spec.name, call.args.clone()).await,
            None => Err(XzError::UnknownTool(call.spec.name.clone())),
        };
        match ran {
            Ok(output) => {
                let summary = summarize(&output.content);
                let taint = merged_taint(call.taint, &output.taint);
                self.finish(
                    Call {
                        taint: &taint,
                        ..call
                    },
                    Settled {
                        decision,
                        verdict,
                        ok: true,
                        summary,
                        output: Some(output),
                    },
                )
                .await
            }
            Err(e) => {
                self.finish(
                    call,
                    Settled {
                        decision,
                        verdict,
                        ok: false,
                        summary: e.to_string(),
                        output: None,
                    },
                )
                .await
            }
        }
    }

    async fn finish(&self, call: Call<'_>, settled: Settled) -> Result<ActResult> {
        let effects = settled
            .output
            .as_ref()
            .map(|output| output.effects.clone())
            .unwrap_or_default();
        self.engram.append(&JournalEvent {
            seq: 0,
            device: String::new(),
            ts_ms: xz_types::now_ms(),
            organism: call.organism.into(),
            task_id: call.task_id.into(),
            tool: call.spec.name.clone(),
            args: call.args.clone(),
            risk: call.spec.effective_risk(),
            verdict: settled.verdict,
            taint: call.taint.clone(),
            ok: settled.ok,
            summary: settled.summary.clone(),
            effects,
            rewound: false,
        })?;
        Ok(ActResult {
            tool: call.spec.name.clone(),
            args: call.args.clone(),
            risk: call.spec.effective_risk(),
            decision: settled.decision,
            verdict: settled.verdict,
            ok: settled.ok,
            summary: settled.summary,
            output: settled.output,
        })
    }
}

struct Call<'a> {
    organism: &'a str,
    task_id: &'a str,
    spec: &'a ToolSpec,
    args: &'a Value,
    taint: &'a Taint,
}

struct Settled {
    decision: Decision,
    verdict: Verdict,
    ok: bool,
    summary: String,
    output: Option<ToolOutput>,
}

fn unknown_spec(tool: &str) -> ToolSpec {
    ToolSpec {
        name: tool.into(),
        description: "not mounted".into(),
        input_schema: json!({}),
        risk: Risk::Commit,
        resource_args: vec![],
        tainted_output: true,
        first_party: false,
    }
}

fn summarize(content: &Value) -> String {
    let text = content.to_string();
    if text.chars().count() <= 180 {
        text
    } else {
        let end = text
            .char_indices()
            .nth(180)
            .map(|(i, _)| i)
            .unwrap_or(text.len());
        format!("{}…", &text[..end])
    }
}

fn merged_taint(call: &Taint, output: &Taint) -> Taint {
    let mut t = call.clone();
    t.merge(output);
    t
}
