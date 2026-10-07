//! `xz` — the command-line Intent Bar.

use std::env;
use std::process::ExitCode;

use xinod::{confirmer, eval_all, genomes_root, home_dir, open_session, render, warm_planner};

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("xz: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> xz_types::Result<()> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        None => {
            eprintln!("usage: xz \"<intent>\" | xz eval | xz journal [limit]");
            Ok(())
        }
        Some("eval") => {
            let report = eval_all(&genomes_root()).await?;
            println!("{} evals, {} failed", report.ran, report.failed.len());
            for fail in &report.failed {
                println!("FAIL {fail}");
            }
            if !report.failed.is_empty() {
                return Err(xz_types::XzError::Other(format!(
                    "{} evals failed",
                    report.failed.len()
                )));
            }
            Ok(())
        }
        Some("journal") => {
            let limit = args.next().and_then(|n| n.parse().ok()).unwrap_or(20usize);
            let home = home_dir()?;
            let session = open_session(&home, confirmer())?;
            let events = session.journal(limit)?;
            if events.is_empty() {
                println!("(journal empty)");
            }
            for ev in events.iter().rev() {
                let mark = if ev.ok { "ok" } else { "failed" };
                println!(
                    "{} {mark} {} {} {}",
                    ev.seq,
                    ev.verdict_label(),
                    ev.tool,
                    ev.summary
                );
            }
            Ok(())
        }
        Some(intent) => {
            let mut words = vec![intent.to_string()];
            words.extend(args);
            let intent = words.join(" ");
            let home = home_dir()?;
            warm_planner().await;
            let session = open_session(&home, confirmer())?;
            let outcome = session.handle(&intent).await?;
            println!("{}", render(&outcome));
            Ok(())
        }
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
