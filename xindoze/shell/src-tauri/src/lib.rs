//! Canvas shell. Android opens this window, runs llama.cpp, and pairs
//! through the Hive device. Desktop plugins stay behind `cfg` so this file
//! does not grow Windows-only shell behavior.

mod phone;
mod runtime;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_android_bridge::init());
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
            .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }
    builder
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
