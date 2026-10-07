//! xinod: read intents from stdin and print what the Organism did.
//!
//! The Canvas talks to this process in a later phase. Until then the
//! terminal is the Intent Bar, one line per intent.

use std::io::{BufRead, Write};
use std::process::ExitCode;

use xinod::{confirmer, home_dir, open_session, render};

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("xinod: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> xz_types::Result<()> {
    let home = home_dir()?;
    let session = open_session(&home, confirmer())?;
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    writeln!(stdout, "xinod ready").ok();
    for line in stdin.lock().lines() {
        let line = line?;
        let intent = line.trim();
        if intent.is_empty() {
            continue;
        }
        if intent == "quit" {
            break;
        }
        match session.handle(intent).await {
            Ok(outcome) => {
                writeln!(stdout, "{}", render(&outcome)).ok();
            }
            Err(e) => {
                writeln!(stdout, "error: {e}").ok();
            }
        }
        let _ = stdout.flush();
    }
    Ok(())
}
