//! Canvas commands for the Android companion.
//!
//! The Intent Bar pairs through `xz_hive::Device` and answers with embedded
//! llama.cpp. Desktop builds keep the same commands; the model call reports
//! that the weights live in the APK.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{Value, json};
use tauri::{AppHandle, State};
use xz_android::{
    Edition, INFERENCE_BACKEND, Intent, PhoneBook, ToolDecision, classify, decide_tool, draft_say,
    model_prompt, place, say_with_line, tier_label,
};
use xz_cortex::Registry;
use xz_types::{JournalEvent, Outcome, Role};

use crate::runtime::{
    CharterView, GenomeInfo, ModelStatus, PeerStatus, Pulse, RewindReport, ToolReply,
};
use tauri_plugin_android_bridge::AndroidBridgeExt;

pub struct PhoneState {
    book: Mutex<PhoneBook>,
    tier: String,
    ram_mb: u64,
    model_loaded: AtomicBool,
}

impl PhoneState {
    pub fn open(install_id: &str, edition: &str, ram_mb: u64) -> Self {
        let edition = Edition::parse(edition);
        let book = PhoneBook::new(install_id, edition)
            .unwrap_or_else(|_| PhoneBook::new("phone", edition).expect("phone identity"));
        let tier = Registry::builtin()
            .map(|registry| tier_label(&registry, ram_mb.max(1)))
            .unwrap_or_else(|_| "spore".into());
        Self {
            book: Mutex::new(book),
            tier,
            ram_mb,
            model_loaded: AtomicBool::new(false),
        }
    }
}

pub fn probe(app: &AppHandle) -> (String, u64, String) {
    match app.android_bridge().status() {
        Ok(status) => (status.install_id, status.ram_mb, status.edition),
        Err(_) => ("phone".into(), 4 * 1024, "fdroid".into()),
    }
}

fn outcome(say: String) -> Outcome {
    Outcome {
        task_id: format!("t{}", xz_types::now_ms()),
        organism: "prime".into(),
        say: Some(say),
        ui: None,
        steps: vec![],
        crystal: None,
        done: true,
    }
}

fn answer(app: &AppHandle, state: &PhoneState, text: String) -> Outcome {
    let mut book = state.book.lock().expect("phone book");
    match classify(&text) {
        Intent::Refused { reason } => outcome(reason),
        Intent::Draft { to, body } => {
            let say = draft_say(&to, &body);
            match app.android_bridge().message_draft(&to, &body) {
                Ok(()) => outcome(say),
                Err(err) => outcome(format!("{say}\n\n{err}")),
            }
        }
        Intent::Pair { seed } => {
            let code = book.begin_pairing(&seed);
            let hex = book.device().identity().id().to_hex();
            outcome(format!(
                "Pairing code {code}. This phone is {hex}. On the desktop, use the same word and confirm this id."
            ))
        }
        Intent::Confirm {
            code,
            name,
            id_hex,
            stronger,
        } => match book.confirm(&code, &name, &id_hex, stronger) {
            Ok(peer) => outcome(format!("Paired with {peer}.")),
            Err(err) => outcome(err.to_string()),
        },
        Intent::Model { text } => {
            let placement = place(book.device(), &text);
            drop(book);
            let prompt = model_prompt(&text);
            let generated = match app.android_bridge().complete(&prompt, 64) {
                Ok(text) => {
                    if !text.starts_with("model:") {
                        state.model_loaded.store(true, Ordering::Relaxed);
                    }
                    text
                }
                Err(err) => err.to_string(),
            };
            outcome(say_with_line(&generated, &placement))
        }
    }
}

#[tauri::command]
pub fn intent(
    app: AppHandle,
    state: State<'_, PhoneState>,
    text: String,
) -> Result<Outcome, String> {
    Ok(answer(&app, &state, text))
}

#[tauri::command]
pub fn intent_for(
    app: AppHandle,
    state: State<'_, PhoneState>,
    organism: String,
    text: String,
) -> Result<Outcome, String> {
    let mut out = answer(&app, &state, text);
    out.organism = organism;
    Ok(out)
}

#[tauri::command]
pub fn tool_call(
    app: AppHandle,
    state: State<'_, PhoneState>,
    organism: String,
    tool: String,
    args: Value,
) -> Result<ToolReply, String> {
    let _ = organism;
    let edition = state.book.lock().expect("phone book").edition();
    match decide_tool(edition, &tool, &args) {
        ToolDecision::Deny { reason } | ToolDecision::Unsupported { reason } => Err(reason),
        ToolDecision::Draft { to, body } => {
            app.android_bridge()
                .message_draft(&to, &body)
                .map_err(|e| e.to_string())?;
            Ok(ToolReply {
                content: json!({"drafted": true, "sent": false, "to": to}),
            })
        }
    }
}

#[tauri::command]
pub fn confirm_reply(id: String, approve: bool) -> Result<(), String> {
    let _ = (id, approve);
    Ok(())
}

#[tauri::command]
pub fn rewind(task_id: String) -> Result<RewindReport, String> {
    let _ = task_id;
    Ok(RewindReport {
        skipped: vec!["This phone has no file changes to undo.".into()],
        ..RewindReport::default()
    })
}

#[tauri::command]
pub fn pulse(state: State<'_, PhoneState>) -> Result<Pulse, String> {
    let book = state.book.lock().expect("phone book");
    let peers = book
        .peers()
        .into_iter()
        .map(|(name, online)| PeerStatus { name, online })
        .collect::<Vec<_>>();
    let loaded = state.model_loaded.load(Ordering::Relaxed);
    Ok(Pulse {
        host: format!("android {} · {} MB", book.edition().as_str(), state.ram_mb),
        tier: state.tier.clone(),
        models: vec![ModelStatus {
            role: Role::Cortex,
            model: "stories15M-q4_0".into(),
            backend: INFERENCE_BACKEND.into(),
            loaded,
        }],
        tokens_per_sec: 0.0,
        requests: 0,
        peers,
        egress: vec![],
        journal_count: 0,
    })
}

#[tauri::command]
pub fn genomes() -> Result<Vec<GenomeInfo>, String> {
    Ok(vec![])
}

#[tauri::command]
pub fn journal(limit: usize) -> Result<Vec<JournalEvent>, String> {
    let _ = limit;
    Ok(vec![])
}

#[tauri::command]
pub fn charter() -> Result<CharterView, String> {
    Ok(CharterView::default())
}

#[tauri::command]
pub fn blob(r#ref: String) -> Result<String, String> {
    let _ = r#ref;
    Ok(String::new())
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let scheme = url.split(':').next().unwrap_or("").to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err("only http(s) links open".into());
    }
    app.android_bridge()
        .open_url(&url)
        .map_err(|e| e.to_string())
}
