//! Desktop Canvas shell. Android keeps the same `run` entry and the same
//! commands; login-hook Takeover is desktop-only and never touches Winlogon.

mod ask;
mod commands;
mod core_runtime;
mod runtime;
mod takeover;

use core_runtime::CoreRuntime;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .try_init()
        .ok();

    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                takeover::handle_second_instance(app, &args);
            }))
            .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
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
