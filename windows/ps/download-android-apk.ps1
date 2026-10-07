. "$PSScriptRoot\common.ps1"

$ArtifactName = 'xindoze-android-apk'   # upload name in xindoze/ci/xindoze.yml

# Token lookup order: GITHUB_TOKEN / GH_TOKEN env, `gh auth token`, then the git credential store.
# The token stays in memory only.
function Get-GitHubToken {
    if ($env:GITHUB_TOKEN) { return $env:GITHUB_TOKEN }
    if ($env:GH_TOKEN) { return $env:GH_TOKEN }
    if (Test-Cmd 'gh') {
        $t = (& gh auth token 2>$null)
        if ($LASTEXITCODE -eq 0 -and $t) { return $t.Trim() }
    }
    $env:GIT_TERMINAL_PROMPT = '0'
    $env:GCM_INTERACTIVE = 'never'
    $out = ("protocol=https`nhost=github.com`n`n" | & git credential fill 2>$null)
    foreach ($line in $out) { if ($line -like 'password=*') { return $line.Substring(9) } }
    return $null
}

Invoke-Main {
    $slug = Get-RepoSlug
    $actionsUrl = "https://github.com/$slug/actions"
    $token = Get-GitHubToken
    if (-not $token) {
        Write-Warn2 'No GitHub token found (set GITHUB_TOKEN, or sign in with gh / git).'
        Write-Info "Opening $actionsUrl - download the '$ArtifactName' artifact from the latest run with an Android job."
        Start-Process $actionsUrl
        return
    }

    $headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'xindoze-windows-scripts' }
    Write-Step "Looking up the latest '$ArtifactName' artifact in $slug"
    $list = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$slug/actions/artifacts?name=$ArtifactName&per_page=10"
    $art = $list.artifacts | Where-Object { -not $_.expired } | Sort-Object created_at -Descending | Select-Object -First 1
    if (-not $art) {
        Write-Warn2 "No unexpired '$ArtifactName' artifact found. The Android job only runs on manual dispatch of the xindoze workflow."
        Write-Info "Opening $actionsUrl"
        Start-Process $actionsUrl
        return
    }
    Write-Ok "Artifact #$($art.id) from $($art.created_at) (branch $($art.workflow_run.head_branch))"

    $dir = Join-Path $OutDir 'android\ci'
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $zip = Join-Path $dir 'artifact.zip'
    Write-Step 'Downloading'
    Invoke-WebRequest -Headers $headers -Uri $art.archive_download_url -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath $dir -Force
    Remove-Item $zip -Force
    $apk = Get-ChildItem $dir -Recurse -Filter '*.apk' | Sort-Object Length -Descending | Select-Object -First 1
    if (-not $apk) { Fail "The artifact did not contain an .apk (see $dir)." }
    Write-Host ''
    Write-Host 'Downloaded.' -ForegroundColor Green
    Write-Ok "APK: $($apk.FullName)"
    Write-Info 'Run install-android.bat to install it on a connected phone.'
}
