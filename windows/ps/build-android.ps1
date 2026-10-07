param([string]$Target = 'aarch64')
. "$PSScriptRoot\common.ps1"

# Same command as xindoze/shell/scripts/android-apk.sh and .github/workflows/xindoze-android.yml.
# cargo tauri android build --debug --apk --target aarch64
# APK path: xindoze\dist\android\xindoze-debug.apk
function Invoke-AndroidTauri([string[]]$TauriArgs) {
    Require-Cmd 'cargo' 'Install Rust stable.'
    $cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE '.cargo' }
    $bin = Join-Path $cargoHome 'bin\cargo-tauri.exe'
    if (-not (Test-Path $bin)) {
        Write-Step 'Installing tauri-cli 2.11.5 (executable cargo-tauri)'
        Invoke-Native 'cargo' @('install', 'tauri-cli', '--version', '2.11.5', '--locked')
    }
    Invoke-Native 'cargo' (@('tauri') + $TauriArgs) $ShellDir
}

Invoke-Main {
    Require-Cmd 'cargo' 'Install Rust stable.'
    Write-Step 'Android environment'
    Use-AndroidEnv
    Invoke-Native 'rustup' @('target', 'add', '--toolchain', 'stable', 'aarch64-linux-android')

    Ensure-UiDeps
    Write-Step 'Building Canvas UI (npm run build)'
    Invoke-Native 'npm' @('run', 'build') $UiDir

    $gen = Join-Path $TauriDir 'gen\android'
    if (-not (Test-Path (Join-Path $gen 'app'))) {
        Write-Step 'Generating the Android project (cargo tauri android init, gitignored)'
        Invoke-AndroidTauri @('android', 'init', '--ci')
    }

    Write-Step "Building debug APK for $Target (first build takes a while)"
    Invoke-AndroidTauri @('android', 'build', '--debug', '--apk', '--target', $Target, '--ci')

    $apk = Get-ChildItem (Join-Path $gen 'app\build\outputs\apk') -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $apk) { Fail "Build reported success but no APK was found under $gen\app\build\outputs\apk" }

    $dist = Join-Path $XzRoot 'dist\android'
    New-Item -ItemType Directory -Force -Path $dist | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'android') | Out-Null
    $copy = Join-Path $dist 'xindoze-debug.apk'
    $mirror = Join-Path $OutDir 'android\xindoze-debug.apk'
    Copy-Item $apk.FullName $copy -Force
    Copy-Item $apk.FullName $mirror -Force
    Write-Host ''
    Write-Host 'APK built.' -ForegroundColor Green
    Write-Ok "APK: $($apk.FullName)"
    Write-Ok "Copy: $copy"
    Write-Info 'Run install-android.bat to install it on a connected phone.'
}
