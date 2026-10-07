//! Command-line Intent Bar.

use std::env;
use std::process::ExitCode;
use std::sync::Arc;
use xinod::{eval_all, genomes_root, open_session, render};
use xz_types::Confirmer;

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("-h") | Some("--help") | None => {
            eprintln!(
                "xz \"<intent>\"    run one intent\nxz eval           run Seed Bank evals against the mock\nxz journal        show the Journal\n\nSet XZ_HOME to a directory. Set XZ_MODEL to an Ollama tag to use a local model."
            );
            if args.is_empty() {
                ExitCode::from(2)
            } else {
                ExitCode::SUCCESS
            }
        }
        Some("eval") => match eval_all(&genomes_root()).await {
            Ok(report) => {
                println!("{} evals, {} failed", report.ran, report.failed);
                for f in &report.failures {
                    eprintln!("FAIL {f}");
                }
                if report.ok() {
                    ExitCode::SUCCESS
                } else {
                    ExitCode::FAILURE
                }
            }
            Err(e) => {
                eprintln!("eval: {e}");
                ExitCode::FAILURE
            }
        },
        Some("journal") => {
            let limit = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(20);
            match open_session(Arc::new(CliConfirm)).await {
                Ok(session) => match session.journal(limit) {
                    Ok(events) => {
                        for ev in events {
                            println!(
                                "{} {} {} {} {}",
                                ev.seq,
                                ev.verdict_label(),
                                ev.tool,
                                ev.summary,
                                ev.task_id
                            );
                        }
                        ExitCode::SUCCESS
                    }
                    Err(e) => {
                        eprintln!("journal: {e}");
                        ExitCode::FAILURE
                    }
                },
                Err(e) => {
                    eprintln!("journal: {e}");
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            let intent = args.join(" ");
            match open_session(Arc::new(CliConfirm)).await {
                Ok(session) => match session.intent(&intent).await {
                    Ok(outcome) => {
                        println!("{}", render(&outcome));
                        ExitCode::SUCCESS
                    }
                    Err(e) => {
                        eprintln!("xz: {e}");
                        ExitCode::FAILURE
                    }
                },
                Err(e) => {
                    eprintln!("xz: {e}");
                    ExitCode::FAILURE
                }
            }
        }
    }
}

struct CliConfirm;

#[async_trait::async_trait]
impl Confirmer for CliConfirm {
    async fn confirm(&self, ask: &xz_types::AskInfo) -> bool {
        eprintln!("confirm {} {} — {}", ask.tool, ask.args, ask.reason);
        if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
            eprintln!("non-interactive; declining");
            return false;
        }
        eprint!("Allow? [y/N] ");
        let mut line = String::new();
        let _ = std::io::stdin().read_line(&mut line);
        matches!(line.trim(), "y" | "Y" | "yes")
    }
}

trait Label {
    fn verdict_label(&self) -> &'static str;
}

impl Label for xz_types::JournalEvent {
    fn verdict_label(&self) -> &'static str {
        match self.verdict {
            xz_types::Verdict::Allowed => "allowed",
            xz_types::Verdict::Confirmed => "confirmed",
            xz_types::Verdict::Declined => "declined",
            xz_types::Verdict::Denied => "denied",
        }
    }
}
