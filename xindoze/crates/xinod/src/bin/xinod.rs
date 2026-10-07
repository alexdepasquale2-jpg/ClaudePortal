//! xinod: read intents from stdin and print what the Organism did.
//!
//! `--service` runs the native boot lifecycle and waits for a signal. It does
//! not install a bootloader or open a session. Without that flag the terminal
//! is the Intent Bar, one line per intent. The Canvas talks to this process
//! in a later phase.

use std::io::{BufRead, Write};
use std::process::ExitCode;

use xinod::{confirmer, home_dir, open_session, render, warm_planner};

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
    if std::env::args().any(|arg| arg == "--service") {
        // In-process lifecycle only. Does not install units or open a session.
        return xz_boot::run_service(std::env::consts::ARCH)
            .await
            .map(|_| ())
            .map_err(|err| xz_types::XzError::Other(err.to_string()));
    }
    let home = home_dir()?;
    warm_planner().await;
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
