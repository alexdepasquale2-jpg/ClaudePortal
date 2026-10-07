//! Tauri commands. Names match `shell/ui/src/lib/api.ts`.

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use xz_types::{JournalEvent, Outcome};

use crate::core_runtime::CoreRuntime;
use crate::runtime::{
    CharterView, ConquestView, GenomeInfo, Pulse, RewindReport, ShellRuntime, StepEvent, ToolReply,
    EVENT_STEP,
};
use crate::takeover::{self, Mode};

type Cmd<T> = Result<T, String>;

fn err(e: impl ToString) -> String {
    e.to_string()
}

fn emit_steps(app: &AppHandle, outcome: &Outcome) {
    for step in &outcome.steps {
        let _ = app.emit(
            EVENT_STEP,
            StepEvent {
                task_id: outcome.task_id.clone(),
                step: step.clone(),
            },
        );
    }
}

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync {
    tauri::generate_handler![
        intent,
        intent_for,
        tool_call,
        confirm_reply,
        rewind,
        pulse,
        genomes,
        journal,
        charter,
        blob,
        open_url,
        conquest,
        set_conquest,
    ]
}

#[tauri::command]
async fn intent(app: AppHandle, state: State<'_, CoreRuntime>, text: String) -> Cmd<Outcome> {
    let outcome = state.intent(&text).await.map_err(err)?;
    emit_steps(&app, &outcome);
    Ok(outcome)
}

#[tauri::command]
async fn intent_for(
    app: AppHandle,
    state: State<'_, CoreRuntime>,
    organism: String,
    text: String,
) -> Cmd<Outcome> {
    let outcome = state.intent_for(&organism, &text).await.map_err(err)?;
    emit_steps(&app, &outcome);
    Ok(outcome)
}

#[tauri::command]
async fn tool_call(
    app: AppHandle,
    state: State<'_, CoreRuntime>,
    organism: String,
    tool: String,
    args: Value,
) -> Cmd<ToolReply> {
    let reply = state.tool_call(&organism, &tool, args).await.map_err(err)?;
    let _ = app;
    Ok(reply)
}

#[tauri::command]
async fn confirm_reply(state: State<'_, CoreRuntime>, id: String, approve: bool) -> Cmd<()> {
    state.confirm_reply(&id, approve).await.map_err(err)
}

#[tauri::command]
async fn rewind(state: State<'_, CoreRuntime>, task_id: String) -> Cmd<RewindReport> {
    state.rewind(&task_id).await.map_err(err)
}

#[tauri::command]
async fn pulse(state: State<'_, CoreRuntime>) -> Cmd<Pulse> {
    state.pulse().await.map_err(err)
}

#[tauri::command]
async fn genomes(state: State<'_, CoreRuntime>) -> Cmd<Vec<GenomeInfo>> {
    state.genomes().await.map_err(err)
}

#[tauri::command]
async fn journal(state: State<'_, CoreRuntime>, limit: usize) -> Cmd<Vec<JournalEvent>> {
    state.journal(limit).await.map_err(err)
}

#[tauri::command]
async fn charter(state: State<'_, CoreRuntime>) -> Cmd<CharterView> {
    state.charter().await.map_err(err)
}

#[tauri::command]
async fn blob(state: State<'_, CoreRuntime>, r#ref: String) -> Cmd<String> {
    state.blob(&r#ref).await.map_err(err)
}

#[tauri::command]
async fn open_url(url: String) -> Cmd<()> {
    commands_open(&url)
}

#[cfg(not(target_os = "android"))]
fn commands_open(url: &str) -> Cmd<()> {
    crate::core_runtime::open_http(url).map_err(err)
}

#[cfg(target_os = "android")]
fn commands_open(_url: &str) -> Cmd<()> {
    Err("open_url on Android is owned by the Android bridge".into())
}

#[tauri::command]
fn conquest() -> ConquestView {
    takeover::view()
}

#[tauri::command]
fn set_conquest(app: AppHandle, mode: String) -> Cmd<ConquestView> {
    let mode = Mode::parse(&mode).ok_or_else(|| format!("unknown conquest mode {mode}"))?;
    takeover::set_mode(&app, mode).map_err(err)?;
    Ok(takeover::view())
}
