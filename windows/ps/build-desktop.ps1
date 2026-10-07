. "$PSScriptRoot\common.ps1"

# Mirrors the "windows" job in xindoze/ci/xindoze.yml: npm ci + build, then tauri build --bundles nsis.
Invoke-Main {
    Require-Cmd 'cargo' 'Install Rust stable.'
    Ensure-UiDeps
    Write-Step 'Building Canvas UI (npm run build)'
    Invoke-Native 'npm' @('run', 'build') $UiDir
    Write-Step 'Building the Tauri desktop shell + NSIS installer (release, this takes a while)'
    # The UI is already built above, so skip tauri's beforeBuildCommand instead of building it twice.
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $override = Join-Path $OutDir 'tauri-build-override.json'
    Set-Content -Path $override -Value '{ "build": { "beforeBuildCommand": "" } }' -Encoding ASCII
    Invoke-Tauri @('build', '--bundles', 'nsis', '--config', $override, $TauriLenient)

    $exe = Find-CanvasExe
    $nsisDir = Join-Path $TargetDir 'release\bundle\nsis'
    $installer = Get-ChildItem $nsisDir -Filter '*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

    Write-Host ''
    Write-Host 'Build finished.' -ForegroundColor Green
    if ($exe)       { Write-Ok "App exe:   $exe" } else { Write-Warn2 "No xindoze-canvas.exe or xindoze-shell.exe in $TargetDir\release" }
    if ($installer) { Write-Ok "Installer: $($installer.FullName)" } else { Write-Warn2 "No installer found in $nsisDir" }
    Write-Info 'Run deploy-desktop.bat to install the exe to Program Files, or run the installer.'
    if (Test-Path $nsisDir) { Start-Process explorer.exe $nsisDir }
}
