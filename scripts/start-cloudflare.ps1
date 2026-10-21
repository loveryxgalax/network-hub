param([string]$CloudflaredPath = 'cloudflared')
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $projectPath 'deployment\cloudflare.local.yml'
if (!(Test-Path -LiteralPath $configPath -PathType Leaf)) { throw 'Prepare the named tunnel with configure-cloudflare.ps1 first.' }
$cliPath = (Get-Command $CloudflaredPath -ErrorAction Stop).Source
$status = Invoke-RestMethod -Uri 'http://127.0.0.1:4317/api/session'
if ($status.setup) { throw 'Create the owner account at http://127.0.0.1:4317 before opening the tunnel.' }
$hostnameMatch = [regex]::Match((Get-Content -LiteralPath $configPath -Raw), '(?m)^\s+- hostname: ([a-z0-9.-]+)\s*$')
if (!$hostnameMatch.Success -or $status.publicOrigin -ne ('https://' + $hostnameMatch.Groups[1].Value)) { throw 'Restart the dashboard with scripts/start-dashboard.ps1 -EnvironmentFile .env.cloudflare before opening the tunnel.' }
& $cliPath tunnel --config $configPath ingress validate
if ($LASTEXITCODE -ne 0) { throw 'Cloudflare ingress validation failed.' }
& $cliPath tunnel --config $configPath run
exit $LASTEXITCODE
