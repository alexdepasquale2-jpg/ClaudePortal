param([switch]$Elevated, [switch]$Uninstall)
. "$PSScriptRoot\common.ps1"

function Stop-Canvas {
    $p = Get-Process -Name 'xindoze-canvas' -ErrorAction SilentlyContinue
    if (-not $p) { return }
    $a = Read-Host 'Xindoze Canvas is running. Close it now? [Y/n]'
    if ($a -ne '' -and $a -notmatch '^[Yy]') { Fail 'Close Xindoze Canvas and try again.' }
    $p | Stop-Process -Force
    Start-Sleep -Seconds 1
}

function Install-Canvas {
    $src = Join-Path $TargetDir 'release\xindoze-shell.exe'
    if (-not (Test-Path $src)) { Fail "No built Canvas at $src. Run build-desktop.bat first." }
    Write-Step "Installing to $InstalledExe"
    Stop-Canvas
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item $src $InstalledExe -Force
    Write-Ok "Copied $src"

    Write-Step 'Start menu shortcut'
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut($ShortcutPath)
    $lnk.TargetPath = $InstalledExe
    $lnk.WorkingDirectory = $InstallDir
    $lnk.IconLocation = "$InstalledExe,0"
    $lnk.Description = 'Xindoze Canvas'
    $lnk.Save()
    Write-Ok $ShortcutPath
    Write-Host 'Deployed. Find "Xindoze Canvas" in the Start menu.' -ForegroundColor Green
}

function Uninstall-Canvas {
    Write-Step 'Removing Xindoze Canvas'
    Stop-Canvas
    if (Test-Path $ShortcutPath) { Remove-Item $ShortcutPath -Force; Write-Ok "Removed $ShortcutPath" } else { Write-Info 'No Start menu shortcut' }
    if (Test-Path $InstalledExe) { Remove-Item $InstalledExe -Force; Write-Ok "Removed $InstalledExe" } else { Write-Info 'No installed exe' }
    if ((Test-Path $InstallDir) -and -not (Get-ChildItem $InstallDir -Force)) { Remove-Item $InstallDir -Force; Write-Ok "Removed $InstallDir" }
    Write-Host 'Uninstalled. (User data in AppData is left alone.)' -ForegroundColor Green
}

if (-not (Test-Admin)) {
    if ($Elevated) { Write-Host 'ERROR: still not elevated.' -ForegroundColor Red; exit 1 }
    Write-Host 'Asking for administrator rights (UAC) to write to Program Files...'
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated')
    if ($Uninstall) { $argList += '-Uninstall' }
    try { $p = Start-Process powershell.exe -Verb RunAs -ArgumentList $argList -Wait -PassThru }
    catch { Write-Host 'ERROR: UAC prompt was cancelled.' -ForegroundColor Red; exit 1 }
    if ($p.ExitCode -ne 0) { Write-Host "ERROR: elevated step failed (exit $($p.ExitCode)); see the elevated window output." -ForegroundColor Red }
    else { Write-Host 'Done (elevated step succeeded).' -ForegroundColor Green }
    exit $p.ExitCode
}

$code = 0
try { if ($Uninstall) { Uninstall-Canvas } else { Install-Canvas } }
catch { Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red; $code = 1 }
if ($Elevated) { Read-Host 'Press Enter to close this window' | Out-Null }
exit $code
