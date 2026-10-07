//! Conquest modes for the desktop Canvas.
//!
//! Takeover is fullscreen-at-login. Explorer (and the Linux session) keep
//! running. The login hook is the per-user Run key or an XDG autostart file,
//! never Winlogon Shell / Userinit and never a display-manager session.
//!
//! Undo, any one of these:
//! - Canvas switch back to Guest
//! - tray item "Undo takeover"
//! - hotkey Ctrl+Alt+Shift+X
//! - `xindoze-canvas --undo-takeover`
//! - after uninstall, delete the hook described by [`UNDO_TEXT`]

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::runtime::ConquestView;

pub const UNDO_TEXT: &str = "Ctrl+Alt+Shift+X, the Canvas Guest switch, the tray item, or `xindoze-canvas --undo-takeover`. After uninstall on Windows: reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v Xindoze /f. After uninstall on Linux: rm ~/.config/autostart/org.xindoze.shell.desktop";

/// Per-user Run key. Not Winlogon.
pub const WINDOWS_RUN_SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
pub const WINDOWS_RUN_VALUE: &str = "Xindoze";
pub const LINUX_AUTOSTART_FILE: &str = "org.xindoze.shell.desktop";
pub const MAC_AGENT: &str = "org.xindoze.shell.plist";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Guest,
    Overlay,
    Takeover,
}

impl Mode {
    pub fn parse(text: &str) -> Option<Self> {
        match text.trim().to_ascii_lowercase().as_str() {
            "guest" => Some(Self::Guest),
            "overlay" => Some(Self::Overlay),
            "takeover" => Some(Self::Takeover),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Guest => "guest",
            Self::Overlay => "overlay",
            Self::Takeover => "takeover",
        }
    }
}

#[derive(Serialize, Deserialize)]
struct FileMode {
    mode: Mode,
}

pub fn view() -> ConquestView {
    ConquestView {
        supported: cfg!(not(target_os = "android")),
        mode: read_mode().as_str().into(),
        undo: UNDO_TEXT.into(),
    }
}

pub fn on_setup(app: &tauri::App) -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    if flag(&args, "--undo-takeover") {
        undo(app.handle())?;
        app.handle().exit(0);
        return Ok(());
    }
    if flag(&args, "--enable-takeover") {
        set_mode(app.handle(), Mode::Takeover)?;
    } else if flag(&args, "--takeover") {
        apply_window(app.get_webview_window("main").as_ref(), Mode::Takeover)?;
    } else {
        apply_window(app.get_webview_window("main").as_ref(), read_mode())?;
    }
    install_tray(app)?;
    install_shortcuts(app)?;
    Ok(())
}

pub fn handle_second_instance(app: &AppHandle, args: &[String]) {
    if flag(args, "--undo-takeover") {
        let _ = undo(app);
        return;
    }
    if flag(args, "--enable-takeover") || flag(args, "--takeover") {
        let _ = set_mode(app, Mode::Takeover);
        return;
    }
    show(app);
}

pub fn set_mode(app: &AppHandle, mode: Mode) -> Result<(), String> {
    match mode {
        Mode::Takeover => install_login_hook()?,
        Mode::Guest | Mode::Overlay => remove_login_hook()?,
    }
    write_mode(mode)?;
    apply_window(app.get_webview_window("main").as_ref(), mode)?;
    Ok(())
}

pub fn undo(app: &AppHandle) -> Result<(), String> {
    set_mode(app, Mode::Guest)
}

fn flag(args: &[String], name: &str) -> bool {
    args.iter().any(|arg| arg == name)
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn apply_window(window: Option<&WebviewWindow>, mode: Mode) -> Result<(), String> {
    let Some(window) = window else {
        return Ok(());
    };
    match mode {
        Mode::Takeover => {
            window.set_always_on_top(false).map_err(|e| e.to_string())?;
            window.set_fullscreen(true).map_err(|e| e.to_string())?;
            window.set_decorations(false).map_err(|e| e.to_string())?;
        }
        Mode::Overlay => {
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            window.set_decorations(true).map_err(|e| e.to_string())?;
            window.set_always_on_top(true).map_err(|e| e.to_string())?;
        }
        Mode::Guest => {
            window.set_always_on_top(false).map_err(|e| e.to_string())?;
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            window.set_decorations(true).map_err(|e| e.to_string())?;
        }
    }
    let _ = window.show();
    Ok(())
}

fn install_tray(app: &tauri::App) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let show_item = MenuItem::with_id(app, "show", "Show Canvas", true, None::<&str>).map_err(|e| e.to_string())?;
    let overlay = MenuItem::with_id(app, "overlay", "Overlay", true, None::<&str>).map_err(|e| e.to_string())?;
    let takeover = MenuItem::with_id(app, "takeover", "Enable takeover at login", true, None::<&str>).map_err(|e| e.to_string())?;
    let undo_item = MenuItem::with_id(app, "undo", "Undo takeover", true, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show_item, &overlay, &takeover, &undo_item, &quit]).map_err(|e| e.to_string())?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Xindoze")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show(app),
            "overlay" => {
                let _ = set_mode(app, Mode::Overlay);
            }
            "takeover" => {
                let _ = set_mode(app, Mode::Takeover);
            }
            "undo" => {
                let _ = undo(app);
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app).map_err(|e| e.to_string())?;
    Ok(())
}

fn install_shortcuts(app: &tauri::App) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
        let summon = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
        let leave = Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),
            Code::KeyX,
        );
        app.global_shortcut()
            .on_shortcut(summon, |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    show(app);
                }
            })
            .map_err(|e| e.to_string())?;
        app.global_shortcut()
            .on_shortcut(leave, |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = undo(app);
                }
            })
            .map_err(|e| e.to_string())?;
    }
    let _ = app;
    Ok(())
}

fn mode_path() -> Result<PathBuf, String> {
    let home = xinod::home_dir().map_err(|e| e.to_string())?;
    let dir = xinod::data_dir(&home);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("conquest.json"))
}

fn read_mode() -> Mode {
    let Ok(path) = mode_path() else {
        return Mode::Guest;
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return Mode::Guest;
    };
    serde_json::from_str::<FileMode>(&text)
        .map(|file| file.mode)
        .unwrap_or(Mode::Guest)
}

fn write_mode(mode: Mode) -> Result<(), String> {
    let path = mode_path()?;
    let text = serde_json::to_string(&FileMode { mode }).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn install_login_hook() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        write_windows_run(&exe)
    }
    #[cfg(target_os = "linux")]
    {
        write_linux_autostart(&exe)
    }
    #[cfg(target_os = "macos")]
    {
        write_mac_agent(&exe)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = exe;
        Err("takeover login hook is not implemented on this OS".into())
    }
}

fn remove_login_hook() -> Result<(), String> {
    #[cfg(windows)]
    {
        delete_windows_run()
    }
    #[cfg(target_os = "linux")]
    {
        let path = linux_autostart_path()?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let path = mac_agent_path()?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        Ok(())
    }
}

#[cfg(windows)]
fn write_windows_run(exe: &Path) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(WINDOWS_RUN_SUBKEY).map_err(|e| e.to_string())?;
    let command = format!("\"{}\" --takeover", exe.display());
    key.set_value(WINDOWS_RUN_VALUE, &command).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn delete_windows_run() -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey_with_flags(WINDOWS_RUN_SUBKEY, winreg::enums::KEY_SET_VALUE);
    let Ok(key) = key else {
        return Ok(());
    };
    match key.delete_value(WINDOWS_RUN_VALUE) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[cfg(target_os = "linux")]
fn write_linux_autostart(exe: &Path) -> Result<(), String> {
    let path = linux_autostart_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = format!(
        "[Desktop Entry]\nType=Application\nName=Xindoze\nComment=Opt-in Takeover. Undo: {UNDO_TEXT}\nExec=\"{}\" --takeover\nX-GNOME-Autostart-enabled=true\n",
        exe.display()
    );
    std::fs::write(path, body).map_err(|e| e.to_string())
}

pub fn linux_autostart_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is unset".to_string())?;
    let base = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| format!("{home}/.config"));
    Ok(PathBuf::from(base).join("autostart").join(LINUX_AUTOSTART_FILE))
}

#[cfg(target_os = "macos")]
fn mac_agent_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is unset".to_string())?;
    Ok(PathBuf::from(home).join("Library/LaunchAgents").join(MAC_AGENT))
}

#[cfg(target_os = "macos")]
fn write_mac_agent(exe: &Path) -> Result<(), String> {
    let path = mac_agent_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\"><dict>\n\
         <key>Label</key><string>org.xindoze.shell</string>\n\
         <key>ProgramArguments</key><array><string>{}</string><string>--takeover</string></array>\n\
         <key>RunAtLoad</key><true/>\n\
         </dict></plist>\n",
        exe.display()
    );
    std::fs::write(path, body).map_err(|e| e.to_string())
}

pub fn windows_hook_is_user_run_key() -> bool {
    let key = WINDOWS_RUN_SUBKEY.to_ascii_lowercase();
    key.contains("currentversion\\run")
        && !key.contains("winlogon")
        && !key.contains("userinit")
        && !key.contains("explorer")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takeover_hook_is_not_the_shell_registry() {
        assert!(windows_hook_is_user_run_key());
        assert_eq!(WINDOWS_RUN_VALUE, "Xindoze");
        let linux = linux_autostart_path().unwrap();
        let text = linux.to_string_lossy();
        assert!(text.contains("autostart"));
        assert!(!text.contains("xsessions"));
        assert!(text.ends_with(LINUX_AUTOSTART_FILE));
    }
}
