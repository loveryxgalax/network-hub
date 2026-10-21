param(
 [Parameter(Mandatory=$true)][string]$Hostname,
 [Parameter(Mandatory=$true)][Guid]$TunnelId,
 [Parameter(Mandatory=$true)][string]$CredentialsFile,
 [switch]$Force
)
$ErrorActionPreference = 'Stop'
$Hostname = $Hostname.ToLowerInvariant()
if ($Hostname.Length -gt 253 -or $Hostname -notmatch '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$') { throw 'Enter a DNS hostname without a URL path or wildcard.' }
$credentialsPath = (Resolve-Path -LiteralPath $CredentialsFile).Path
$credentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
if ([string]$credentials.TunnelID -ne $TunnelId.ToString()) { throw 'The credentials belong to a different tunnel.' }
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $projectPath 'deployment\cloudflare.local.yml'
$environmentPath = Join-Path $projectPath '.env.cloudflare'
if (!$Force -and ((Test-Path -LiteralPath $configPath) -or (Test-Path -LiteralPath $environmentPath))) { throw 'Deployment files already exist. Review them before using -Force.' }
$quotedCredentials = ConvertTo-Json -InputObject $credentialsPath -Compress
$configuration = @"
tunnel: $TunnelId
credentials-file: $quotedCredentials
ingress:
  - hostname: $Hostname
    service: http://127.0.0.1:4317
    originRequest:
      httpHostHeader: $Hostname
  - service: http_status:404
"@
$environment = "HOST=127.0.0.1`nPORT=4317`nNETWORK_POLL_MS=30000`nNETWORK_PUBLIC_ORIGIN=https://$Hostname`n"
# These files contain a credentials path and an origin, never the tunnel secret itself.
[IO.File]::WriteAllText($configPath, $configuration)
[IO.File]::WriteAllText($environmentPath, $environment)
Write-Output 'Prepared deployment/cloudflare.local.yml and .env.cloudflare. No tunnel or DNS record was created.'
