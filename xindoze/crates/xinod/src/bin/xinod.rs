//! Foreground daemon. One intent per stdin line, the reply on stdout.
//! Phase 0 has no socket; the Canvas will attach here in phase 1.

use std::io::{BufRead, Write};
use std::sync::Arc;
use xinod::open_session;

#[tokio::main]
async fn main() {
    eprintln!("Xindoze has evolved.");
    let session = match open_session(Arc::new(Decline)).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("xinod: {e}");
            std::process::exit(1);
        }
    };
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        match session.intent(&line).await {
            Ok(outcome) => {
                let say = outcome.say.unwrap_or_default();
                let _ = writeln!(out, "{say}");
            }
            Err(e) => eprintln!("xinod: {e}"),
        }
    }
}

struct Decline;

#[async_trait::async_trait]
impl xz_types::Confirmer for Decline {
    async fn confirm(&self, ask: &xz_types::AskInfo) -> bool {
        eprintln!("declined {} ({})", ask.tool, ask.reason);
        false
    }
}
