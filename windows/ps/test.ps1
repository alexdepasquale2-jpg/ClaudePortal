param([switch]$RustOnly, [switch]$UiOnly)
. "$PSScriptRoot\common.ps1"

Invoke-Main {
    $failed = @()

    if (-not $UiOnly) {
        Write-Step 'Rust tests (same -p list as .github/workflows/xindoze-rust.yml)'
        Require-Cmd 'cargo' 'Install Rust stable.'
        $pkgs = $CiCrates | ForEach-Object { '-p', $_ }
        try { Invoke-Native 'cargo' (@('+stable', 'test', '--locked') + $pkgs) $XzRoot; Write-Ok 'Rust tests passed' }
        catch { Write-Host "    FAIL $($_.Exception.Message)" -ForegroundColor Red; $failed += 'Rust tests' }
    }

    if (-not $RustOnly) {
        Write-Step 'Canvas UI checks (npm run check, npm test, npm run build)'
        Ensure-UiDeps
        foreach ($s in @(@('run', 'check'), @('test'), @('run', 'build'))) {
            try { Invoke-Native 'npm' $s $UiDir; Write-Ok "npm $($s -join ' ')" }
            catch { Write-Host "    FAIL $($_.Exception.Message)" -ForegroundColor Red; $failed += "npm $($s -join ' ')" }
        }
    }

    Write-Host ''
    if ($failed.Count) { Fail "Failed: $($failed -join ', ')" }
    Write-Host 'All tests passed.' -ForegroundColor Green
}
