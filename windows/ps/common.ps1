# Shared helpers for the windows\*.bat one-click scripts. Windows PowerShell 5.1 compatible, ASCII only.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Script:RepoRoot  = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Script:XzRoot    = Join-Path $RepoRoot 'xindoze'
$Script:ShellDir  = Join-Path $XzRoot 'shell'
$Script:UiDir     = Join-Path $ShellDir 'ui'
$Script:TauriDir  = Join-Path $ShellDir 'src-tauri'
$Script:TargetDir = Join-Path $XzRoot 'target'
$Script:OutDir    = Join-Path $RepoRoot 'windows\out'
$Script:TauriCli  = '@tauri-apps/cli@2'
# Cargo.lock pins tauri 2.11 while the UI uses @tauri-apps/api 2.12; the CLI refuses to build on that minor mismatch.
$Script:TauriLenient = '--ignore-version-mismatches'

# Same crate list as .github/workflows/xindoze-rust.yml. No --workspace: it pulls in the shell (GTK on Linux).
$Script:CiCrates = @('xz-types','xz-warden','xz-cortex','xz-engram','xz-genome','xz-bridge',
                     'xz-senses','xz-hive','xz-darwin','xz-core','xinod')

$Script:InstallDir   = Join-Path $env:ProgramFiles 'Xindoze'
$Script:InstalledExe = Join-Path $InstallDir 'xindoze-canvas.exe'
$Script:ShortcutPath = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Xindoze Canvas.lnk'

function Write-Step([string]$msg) { Write-Host ''; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg){ Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Write-Info([string]$msg) { Write-Host "        $msg" }

function Fail([string]$msg) { throw $msg }

# Run a native command and throw if it exits non-zero.
function Invoke-Native {
    param([Parameter(Mandatory)][string]$Exe, [string[]]$ArgList = @(), [string]$Dir = $null)
    $shown = ($ArgList | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' '
    Write-Host "    > $Exe $shown" -ForegroundColor DarkGray
    if ($Dir) { Push-Location $Dir }
    try {
        & $Exe @ArgList
        if ($LASTEXITCODE -ne 0) { Fail "'$Exe $shown' failed with exit code $LASTEXITCODE" }
    } finally { if ($Dir) { Pop-Location } }
}

function Test-Cmd([string]$name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# Rebuilds PATH from Machine + User + the current process, with cargo first.
# Entries are expanded, unquoted and de-duplicated: one stray '"' in an entry (e.g. `C:\Program Files\GitHub CLI"`)
# makes Rust's PATH parser (used by the Tauri CLI to spawn cargo) swallow every later entry, while PowerShell still
# finds cargo. That gives "failed to run 'cargo metadata' ... program not found".
function Update-PathFromRegistry {
    $parts = @("$env:USERPROFILE\.cargo\bin")
    if ($env:CARGO_HOME) { $parts = @("$env:CARGO_HOME\bin") + $parts }
    $parts += [Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';'
    $parts += [Environment]::GetEnvironmentVariable('Path', 'User') -split ';'
    $parts += $env:Path -split ';'
    $seen = @{}
    $clean = foreach ($p in $parts) {
        if (-not $p) { continue }
        $p = [Environment]::ExpandEnvironmentVariables($p).Trim().Trim('"').Trim()
        if (-not $p) { continue }
        $key = $p.TrimEnd('\').ToLowerInvariant()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $p
    }
    $env:Path = $clean -join ';'
}

function Require-Cmd([string]$name, [string]$hint) {
    if (-not (Test-Cmd $name)) { Fail "'$name' was not found on PATH. $hint Run windows\setup.bat first." }
}

function Get-RustVersion {
    if (-not (Test-Cmd 'rustc')) { return $null }
    $v = (& rustc +stable --version 2>$null)
    if (-not $v) { $v = (& rustc --version 2>$null) }
    if ($v -match '(\d+)\.(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
    return $null
}

function Test-MsvcTools {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { return $false }
    $p = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    return [bool]$p
}

function Get-WebView2Version {
    $guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($k in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$guid",
                     "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$guid",
                     "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$guid")) {
        $pv = (Get-ItemProperty -Path $k -Name pv -ErrorAction SilentlyContinue).pv
        if ($pv -and $pv -ne '0.0.0.0') { return $pv }
    }
    return $null
}

# Installs the Canvas UI node_modules when missing or older than package-lock.json (CI uses npm ci).
function Ensure-UiDeps {
    Require-Cmd 'npm' 'Install Node.js 22 LTS.'
    $nm = Join-Path $UiDir 'node_modules'
    $lock = Join-Path $UiDir 'package-lock.json'
    $stamp = Join-Path $nm '.package-lock.json'
    if ((Test-Path $stamp) -and ((Get-Item $stamp).LastWriteTime -ge (Get-Item $lock).LastWriteTime)) {
        Write-Ok 'Canvas UI node_modules up to date'
        return
    }
    Write-Step 'Installing Canvas UI dependencies (npm ci)'
    Invoke-Native 'npm' @('ci') $UiDir
}

# Prefers `cargo tauri` (tauri-cli 2.x) and falls back to the npx CLI that CI uses.
function Get-TauriRunner {
    if ((Test-Cmd 'cargo') -and (Test-Cmd 'cargo-tauri')) {
        $v = (& cargo tauri --version 2>$null)
        if ($LASTEXITCODE -eq 0 -and "$v" -match 'tauri-cli 2\.') { return @{ Exe = 'cargo'; Pre = @('tauri'); Name = "$v".Trim() } }
    }
    Require-Cmd 'npx' 'Install Node.js 22 LTS.'
    return @{ Exe = 'npx'; Pre = @('--yes', $TauriCli); Name = "npx $TauriCli" }
}

function Invoke-Tauri([string[]]$TauriArgs) {
    $r = Get-TauriRunner
    Invoke-Native $r.Exe ($r.Pre + $TauriArgs) $ShellDir
}

# Built Canvas exe: xindoze-canvas.exe (Windows mainBinaryName), else the crate name xindoze-shell.exe.
function Find-CanvasExe {
    foreach ($n in @('xindoze-canvas.exe', 'xindoze-shell.exe')) {
        $p = Join-Path $TargetDir "release\$n"
        if (Test-Path $p) { return $p }
    }
    return $null
}

# ---------- Android environment ----------

function Find-AndroidSdk {
    foreach ($c in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))) {
        if ($c -and (Test-Path (Join-Path $c 'platform-tools')) ) { return $c }
        if ($c -and (Test-Path (Join-Path $c 'cmdline-tools'))) { return $c }
    }
    return $null
}

function Find-Ndk([string]$sdk) {
    if ($env:NDK_HOME -and (Test-Path $env:NDK_HOME)) { return $env:NDK_HOME }
    if (-not $sdk) { return $null }
    $d = Join-Path $sdk 'ndk'
    if (-not (Test-Path $d)) { return $null }
    $best = Get-ChildItem $d -Directory | Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending | Select-Object -First 1
    if ($best) { return $best.FullName }
    return $null
}

function Find-Jdk {
    $cands = @()
    if ($env:JAVA_HOME) { $cands += $env:JAVA_HOME }
    $cands += 'C:\Program Files\Android\Android Studio\jbr'
    foreach ($root in @('C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Microsoft', 'C:\Program Files\Java', 'C:\Program Files\Zulu')) {
        if (Test-Path $root) {
            $cands += (Get-ChildItem $root -Directory -Filter 'jdk*' | Sort-Object Name -Descending | ForEach-Object FullName)
        }
    }
    # CI builds the APK with JDK 17; newer JDKs can be ahead of the generated Gradle version.
    $cands = @($cands | Where-Object { $_ -match 'jbr$|jdk-?17' }) + @($cands | Where-Object { $_ -match 'jdk-?21' }) + $cands
    foreach ($c in $cands) {
        if ($c -and (Test-Path (Join-Path $c 'bin\javac.exe'))) { return $c }
    }
    return $null
}

function Find-Adb {
    $sdk = Find-AndroidSdk
    if ($sdk) {
        $a = Join-Path $sdk 'platform-tools\adb.exe'
        if (Test-Path $a) { return $a }
    }
    $c = Get-Command adb -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    return $null
}

# Sets JAVA_HOME, ANDROID_HOME, NDK_HOME for this process (what the CI android job sets up).
function Use-AndroidEnv {
    $jdk = Find-Jdk;        if (-not $jdk) { Fail 'No JDK 17+ found (JAVA_HOME). Run windows\setup.bat and accept the Android step.' }
    $sdk = Find-AndroidSdk; if (-not $sdk) { Fail 'No Android SDK found (ANDROID_HOME). Run windows\setup.bat and accept the Android step.' }
    $ndk = Find-Ndk $sdk;   if (-not $ndk) { Fail "No Android NDK found under $sdk\ndk. Run windows\setup.bat and accept the Android step." }
    $env:JAVA_HOME = $jdk; $env:ANDROID_HOME = $sdk; $env:ANDROID_SDK_ROOT = $sdk; $env:NDK_HOME = $ndk
    $env:Path = "$jdk\bin;$sdk\platform-tools;$env:Path"
    Write-Ok "JAVA_HOME=$jdk"
    Write-Ok "ANDROID_HOME=$sdk"
    Write-Ok "NDK_HOME=$ndk"
}

function Get-RepoSlug {
    $url = (& git -C $RepoRoot remote get-url origin 2>$null)
    if ($url -match 'github\.com[:/]+([^/]+)/([^/.]+?)(\.git)?$') { return "$($Matches[1])/$($Matches[2])" }
    return 'alexdepasquale2-jpg/ClaudePortal'
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Runs the given script body; prints a clear error and exits 1 on failure.
function Invoke-Main([scriptblock]$Body) {
    try {
        Update-PathFromRegistry
        & $Body
        exit 0
    } catch {
        Write-Host ''
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        if ($env:XZ_DEBUG) { Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray }
        exit 1
    }
}
