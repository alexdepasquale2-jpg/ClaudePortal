param([string]$Apk)
. "$PSScriptRoot\common.ps1"

Invoke-Main {
    $adb = Find-Adb
    if (-not $adb) { Fail 'adb not found. Run setup.bat (Android step) to install platform-tools.' }
    Write-Ok "adb: $adb"

    if (-not $Apk) {
        $cands = @()
        $cands += Get-ChildItem (Join-Path $OutDir 'android') -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue
        $cands += Get-ChildItem (Join-Path $TauriDir 'gen\android\app\build\outputs\apk') -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue
        $pick = $cands | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $pick) { Fail 'No APK found. Run build-android.bat or download-android-apk.bat first (or pass a path).' }
        $Apk = $pick.FullName
    }
    if (-not (Test-Path $Apk)) { Fail "APK not found: $Apk" }
    Write-Ok "APK: $Apk"

    Write-Step 'Connected devices'
    & $adb start-server | Out-Null
    $devices = @(& $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\S+\s+(device|unauthorized|offline)' })
    $devices | ForEach-Object { Write-Info $_ }
    $ready = @($devices | Where-Object { $_ -match '\sdevice$' })
    if (-not $ready.Count) {
        if ($devices -match 'unauthorized') { Fail 'Phone is connected but unauthorized: unlock it and accept the "Allow USB debugging" prompt, then retry.' }
        Fail 'No phone found. Enable Developer options > USB debugging, connect via USB, then retry.'
    }

    $serialArgs = @()
    if ($ready.Count -gt 1) {
        $serial = ($ready[0] -split '\s+')[0]
        Write-Warn2 "Multiple devices; installing to $serial"
        $serialArgs = @('-s', $serial)
    }
    Write-Step 'Installing (adb install -r)'
    Invoke-Native $adb ($serialArgs + @('install', '-r', $Apk))
    Write-Host 'Installed. Open Xindoze from the phone''s app drawer.' -ForegroundColor Green
}
