# Windows one-click scripts

Double-click any `.bat` here. Each one runs a PowerShell helper from `ps\`, prints a red `ERROR:` line on failure, and pauses so the window stays open. `all.bat` is a menu for everything.

| Script | What it does |
|---|---|
| `setup.bat` | Checks/installs Rust stable (1.90+, the shell needs it), MSVC C++ build tools, WebView2, Node + `npm ci` for the Canvas UI, and the Tauri CLI (`cargo tauri` 2.x if installed, otherwise `npx @tauri-apps/cli@2` as CI uses). Optionally installs JDK 17, Android SDK/NDK and the Rust Android targets. Uses `winget`. |
| `build-desktop.bat` | `npm run build`, then `tauri build --bundles nsis` (skipping the config's `beforeBuildCommand`, since the UI is already built). Output: `xindoze\target\release\xindoze-canvas.exe` (`xindoze-shell.exe` on builds without the Windows `mainBinaryName`) and `xindoze\target\release\bundle\nsis\*.exe`. |
| `run-desktop.bat` | `tauri dev` (Vite on :5173 with hot reload). |
| `build-android.bat` | `tauri android init` (first time), then `tauri android build --debug --apk --target aarch64`. Copies the APK to `windows\out\android\`. |
| `download-android-apk.bat` | Downloads the newest `xindoze-android-apk` CI artifact into `windows\out\android\ci\`. Uses `GITHUB_TOKEN`/`GH_TOKEN`, `gh`, or your git credentials (kept in memory only); otherwise opens the Actions page. |
| `install-android.bat` | `adb install -r` the newest APK onto a USB-connected phone (USB debugging on). |
| `test.bat` | `cargo +stable test --locked` with the same `-p` list as `.github/workflows/xindoze-rust.yml` (never `--workspace`), then `npm run check`, `npm test`, `npm run build`. |
| `deploy-desktop.bat` | Asks for UAC, copies the built exe to `C:\Program Files\Xindoze\xindoze-canvas.exe`, and adds a Start menu shortcut "Xindoze Canvas". |
| `uninstall-desktop.bat` | Reverses `deploy-desktop.bat`. |

Notes

- Commands mirror `xindoze/ci/xindoze.yml` (windows and android jobs) and `.github/workflows/xindoze-rust.yml`.
- The Android CI job runs only on manual dispatch, so `download-android-apk.bat` may find no artifact.
- If `tauri android build` fails with a symlink error, turn on Windows Developer Mode (Settings > System > For developers).
- Every script rebuilds `PATH` from the registry first (expanded, unquoted, de-duplicated, `%USERPROFILE%\.cargo\bin` first). A stray `"` in a PATH entry makes the Tauri CLI fail with `failed to run 'cargo metadata' ... program not found` even though `cargo` works in a terminal.
- Set `XZ_DEBUG=1` to print stack traces on errors.
