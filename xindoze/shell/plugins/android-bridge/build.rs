// The webview never calls this plugin directly: Rust reaches Kotlin through
// `run_mobile_plugin`, so no JS-facing commands (and no permissions) are generated.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
