//! Canvas shell.
//!
//! Android opens this window, runs llama.cpp, and pairs through the Hive
//! device. That path stays the phone entry. Desktop adds the xinod session
//! and login-hook Takeover, which never touches Winlogon.

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod ask;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod commands;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod core_runtime;
#[cfg(any(target_os = "android", target_os = "ios"))]
mod phone;
mod runtime;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod takeover;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use core_runtime::CoreRuntime;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    run_phone();
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    run_desktop();
}

/// Phone entry. Same plugin, state, and commands as the Android shell.
#[cfg(any(target_os = "android", target_os = "ios"))]
fn run_phone() {
    tauri::Builder::default()
        .plugin(tauri_plugin_android_bridge::init())
        .setup(|app| {
            let (install, ram, edition) = phone::probe(app.handle());
            app.manage(phone::PhoneState::open(&install, &edition, ram));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            phone::intent,
            phone::intent_for,
            phone::tool_call,
            phone::confirm_reply,
            phone::rewind,
            phone::pulse,
            phone::genomes,
            phone::journal,
            phone::charter,
            phone::blob,
            phone::open_url,
        ])
        .run(tauri::generate_context!())
        .expect("Xindoze failed to start");
}

/// Desktop entry. xinod plans intents; Takeover is fullscreen-at-login.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn run_desktop() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .try_init()
        .ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_android_bridge::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            takeover::handle_second_instance(app, &args);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let runtime = CoreRuntime::open(app.handle().clone())?;
            app.manage(runtime);
            if let Err(err) = takeover::on_setup(app) {
                tracing::warn!(%err, "desktop chrome setup failed");
            }
            Ok(())
        })
        .invoke_handler(commands::handler())
        .run(tauri::generate_context!())
        .expect("Xindoze Canvas failed to start");
}
