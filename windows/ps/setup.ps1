param([switch]$Android, [switch]$NoAndroid)
. "$PSScriptRoot\common.ps1"

$MinRust      = [version]'1.90.0'   # shell/src-tauri needs 1.90; the library crates need 1.85
$CmdlineZip   = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
$SdkPackages  = @('platform-tools', 'platforms;android-35', 'build-tools;35.0.0', 'ndk;27.2.12479018', 'cmdline-tools;latest')
$RustAndroid  = @('aarch64-linux-android', 'armv7-linux-androideabi', 'i686-linux-android', 'x86_64-linux-android')

function Winget-Install([string]$id, [string[]]$extra = @()) {
    if (-not (Test-Cmd 'winget')) { Fail "winget is not available. Install '$id' manually, then re-run setup." }
    Invoke-Native 'winget' (@('install', '--id', $id, '-e', '--accept-source-agreements', '--accept-package-agreements') + $extra)
    Update-PathFromRegistry
}

function Ask([string]$q) {
    $a = Read-Host "$q [Y/n]"
    return ($a -eq '' -or $a -match '^[Yy]')
}

Invoke-Main {
    Write-Host 'Xindoze Windows setup: checks prerequisites and installs what is missing.' -ForegroundColor White
    $problems = @()

    # Rust
    Write-Step 'Rust (stable, 1.90+ for the Canvas shell)'
    if (-not (Test-Cmd 'rustup')) {
        Write-Warn2 'rustup not found, installing via winget'
        Winget-Install 'Rustlang.Rustup'
    }
    Invoke-Native 'rustup' @('toolchain', 'install', 'stable', '--profile', 'minimal', '-c', 'clippy', '-c', 'rustfmt')
    $rv = Get-RustVersion
    if (-not $rv -or $rv -lt $MinRust) {
        Invoke-Native 'rustup' @('update', 'stable')
        $rv = Get-RustVersion
    }
    if ($rv -ge $MinRust) { Write-Ok "rustc $rv" } else { $problems += "Rust stable is $rv, need $MinRust+" }

    # MSVC
    Write-Step 'MSVC C++ build tools'
    if (Test-MsvcTools) { Write-Ok 'Visual C++ x64 tools found' }
    else {
        Write-Warn2 'MSVC build tools missing, installing VS 2022 Build Tools (C++ workload). This takes a while.'
        Winget-Install 'Microsoft.VisualStudio.2022.BuildTools' @('--override', '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
        if (Test-MsvcTools) { Write-Ok 'Visual C++ tools installed' } else { $problems += 'MSVC C++ build tools still not detected' }
    }

    # WebView2
    Write-Step 'WebView2 runtime'
    $wv = Get-WebView2Version
    if ($wv) { Write-Ok "WebView2 $wv" }
    else {
        Winget-Install 'Microsoft.EdgeWebView2Runtime'
        if (Get-WebView2Version) { Write-Ok 'WebView2 installed' } else { $problems += 'WebView2 runtime not detected' }
    }

    # Node + npm deps + tauri cli
    Write-Step 'Node.js and npm (CI uses Node 22)'
    if (-not (Test-Cmd 'npm')) { Winget-Install 'OpenJS.NodeJS.LTS' }
    if (Test-Cmd 'npm') {
        Write-Ok "node $(& node --version)  npm $(& npm --version)"
        Ensure-UiDeps
        Write-Step 'Tauri CLI (cargo tauri if installed, else npx, as CI uses)'
        $r = Get-TauriRunner
        Invoke-Native $r.Exe ($r.Pre + @('--version')) $ShellDir
        Write-Ok "Using $($r.Name)"
    } else { $problems += 'npm not found after install (open a new window and re-run setup)' }

    # Android
    $doAndroid = $Android -or ((-not $NoAndroid) -and (Ask 'Set up the Android toolchain (JDK 17, SDK, NDK, ~5 GB) for APK builds?'))
    if ($doAndroid) {
        Write-Step 'JDK 17'
        if (-not (Find-Jdk)) { Winget-Install 'EclipseAdoptium.Temurin.17.JDK' }
        $jdk = Find-Jdk
        if (-not $jdk) { Fail 'JDK still not found after install.' }
        Write-Ok $jdk
        $env:JAVA_HOME = $jdk

        Write-Step 'Android SDK + NDK'
        $sdk = Find-AndroidSdk
        if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
        $sdkmgr = Get-ChildItem (Join-Path $sdk 'cmdline-tools') -Recurse -Filter 'sdkmanager.bat' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $sdkmgr) {
            Write-Info "Downloading Android command-line tools to $sdk"
            New-Item -ItemType Directory -Force -Path (Join-Path $sdk 'cmdline-tools') | Out-Null
            $zip = Join-Path $env:TEMP 'xz-cmdline-tools.zip'
            Invoke-WebRequest -Uri $CmdlineZip -OutFile $zip -UseBasicParsing
            $tmp = Join-Path $env:TEMP 'xz-cmdline-tools'
            if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
            Expand-Archive $zip -DestinationPath $tmp -Force
            $dest = Join-Path $sdk 'cmdline-tools\bootstrap'
            if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
            Move-Item (Join-Path $tmp 'cmdline-tools') $dest
            Remove-Item $zip -Force
            $sdkmgr = Get-Item (Join-Path $dest 'bin\sdkmanager.bat')
        }
        Write-Info 'Accepting SDK licenses'
        $y = ('y' + [Environment]::NewLine) * 30
        $y | & $sdkmgr.FullName "--sdk_root=$sdk" --licenses | Out-Null
        Invoke-Native $sdkmgr.FullName (@("--sdk_root=$sdk") + $SdkPackages)

        [Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
        [Environment]::SetEnvironmentVariable('JAVA_HOME', $jdk, 'User')
        $ndk = Find-Ndk $sdk
        if ($ndk) { [Environment]::SetEnvironmentVariable('NDK_HOME', $ndk, 'User') }
        Write-Ok "ANDROID_HOME=$sdk (saved for your user)"
        Write-Ok "NDK_HOME=$ndk (saved for your user)"

        Write-Step 'Rust Android targets'
        Invoke-Native 'rustup' (@('target', 'add', '--toolchain', 'stable') + $RustAndroid)
    } else {
        Write-Info 'Skipped Android toolchain. Re-run setup.bat and answer Y when you want APK builds.'
    }

    Write-Host ''
    if ($problems.Count) {
        $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        Fail "$($problems.Count) prerequisite(s) still need attention (see above)."
    }
    Write-Host 'Setup complete. Open a NEW window so PATH/env changes apply everywhere.' -ForegroundColor Green
}
