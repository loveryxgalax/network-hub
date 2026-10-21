param([string]$CloudflaredPath = 'cloudflared')
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $projectPath 'deployment\cloudflare.local.yml'
$previewPath = Join-Path $projectPath 'deployment\cloudflare.acs-preview.local.yml'
$backupPath = Join-Path $projectPath 'deployment\cloudflare.before-acs.local.yml'
$cliPath = (Get-Command $CloudflaredPath -ErrorAction Stop).Source
$text = Get-Content -LiteralPath $configPath -Raw
$hostMatch = [regex]::Match($text, '(?m)^\s+- hostname: ([a-z0-9.-]+)\s*$')
if (!$hostMatch.Success) { throw 'The current tunnel has no published hostname.' }
$hostname = $hostMatch.Groups[1].Value
if ($text -match '(?m)^\s+path:.*cwmp') {
    if ($text -match '(?m)^\s+service: http://127\.0\.0\.1:7547\s*$') {
        $upgraded = $text.Replace('service: http://127.0.0.1:7547','service: http://127.0.0.1:7548')
        [IO.File]::WriteAllText($previewPath,$upgraded)
        & $cliPath tunnel --config $previewPath ingress validate
        if ($LASTEXITCODE -ne 0) { throw 'CWMP isolation route validation failed.' }
        if (!(Test-Path -LiteralPath $backupPath)) { Copy-Item -LiteralPath $configPath -Destination $backupPath }
        Move-Item -LiteralPath $previewPath -Destination $configPath -Force
    } elseif ($text -notmatch '(?m)^\s+service: http://127\.0\.0\.1:7548\s*$') { throw 'An existing CWMP route needs review.' }
    & $cliPath tunnel --config $configPath ingress validate
    if ($LASTEXITCODE -ne 0) { throw 'Ingress validation failed.' }
    Write-Output ('CWMP route already configured: https://' + $hostname + '/cwmp/')
    exit 0
}
$marker = [regex]::Match($text, '(?m)^ingress:\s*\r?\n')
if (!$marker.Success) { throw 'No ingress section was found.' }
$route = "  - hostname: $hostname`n    path: ^/cwmp(/.*)?$`n    service: http://127.0.0.1:7548`n    originRequest:`n      httpHostHeader: $hostname`n"
$updated = $text.Insert($marker.Index + $marker.Length, $route)
[IO.File]::WriteAllText($previewPath, $updated)
& $cliPath tunnel --config $previewPath ingress validate
if ($LASTEXITCODE -ne 0) { throw 'Proposed CWMP ingress validation failed; the current configuration was preserved.' }
if (!(Test-Path -LiteralPath $backupPath)) { Copy-Item -LiteralPath $configPath -Destination $backupPath }
Move-Item -LiteralPath $previewPath -Destination $configPath -Force
Write-Output ('Configured https://' + $hostname + '/cwmp/; restart the tunnel to apply. NBI and MongoDB have no public route.')
