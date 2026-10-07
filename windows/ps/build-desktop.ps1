. "$PSScriptRoot\common.ps1"

# Mirrors the "windows" job in xindoze/ci/xindoze.yml: npm ci + build, then tauri build --bundles nsis.
Invoke-Main {
    Require-Cmd 'cargo' 'Install Rust stable.'
    Ensure-UiDeps
    Write-Step 'Building Canvas UI (npm run build)'
    Invoke-Native 'npm' @('run', 'build') $UiDir
    Write-Step 'Building the Tauri desktop shell + NSIS installer (release, this takes a while)'
    Invoke-Tauri @('build', '--bundles', 'nsis')

    $exe = Join-Path $TargetDir 'release\xindoze-shell.exe'
    $nsisDir = Join-Path $TargetDir 'release\bundle\nsis'
    $installer = Get-ChildItem $nsisDir -Filter '*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

    Write-Host ''
    Write-Host 'Build finished.' -ForegroundColor Green
    if (Test-Path $exe) { Write-Ok "App exe:   $exe" } else { Write-Warn2 "Expected $exe but it is missing" }
    if ($installer)     { Write-Ok "Installer: $($installer.FullName)" } else { Write-Warn2 "No installer found in $nsisDir" }
    Write-Info 'Run deploy-desktop.bat to install the exe to Program Files, or run the installer (per-user).'
    if (Test-Path $nsisDir) { Start-Process explorer.exe $nsisDir }
}
