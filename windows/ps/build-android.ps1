param([string]$Target = 'aarch64')
. "$PSScriptRoot\common.ps1"

# Mirrors the "android" job in xindoze/ci/xindoze.yml (JDK 17, NDK, npm ci + build, tauri android).
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
        Write-Step 'Generating the Android project (tauri android init, gitignored)'
        Invoke-Tauri @('android', 'init', '--ci')
    }

    Write-Step "Building debug APK for $Target (first build takes a while)"
    Invoke-Tauri @('android', 'build', '--debug', '--apk', '--target', $Target, '--ci')

    $apk = Get-ChildItem (Join-Path $gen 'app\build\outputs\apk') -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $apk) { Fail "Build reported success but no APK was found under $gen\app\build\outputs\apk" }

    New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'android') | Out-Null
    $copy = Join-Path $OutDir 'android\xindoze-debug.apk'
    Copy-Item $apk.FullName $copy -Force
    Write-Host ''
    Write-Host 'APK built.' -ForegroundColor Green
    Write-Ok "APK: $($apk.FullName)"
    Write-Ok "Copy: $copy"
    Write-Info 'Run install-android.bat to install it on a connected phone.'
}
