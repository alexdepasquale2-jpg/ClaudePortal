. "$PSScriptRoot\common.ps1"

# tauri dev runs beforeDevCommand (vite on :5173) and hot-reloads the Canvas UI.
Invoke-Main {
    Require-Cmd 'cargo' 'Install Rust stable.'
    Ensure-UiDeps
    Write-Step 'Starting the desktop shell in dev mode (close the app window or press Ctrl+C to stop)'
    Invoke-Tauri @('dev', $TauriLenient)
}
