param([string]$EnvironmentFile = '.env')
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$envPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $projectPath $EnvironmentFile }
$nodeArguments = @()
if (Test-Path -LiteralPath $envPath -PathType Leaf) { $nodeArguments += "--env-file=$envPath" }
$nodeArguments += (Join-Path $projectPath 'server.cjs')
& $nodePath @nodeArguments
exit $LASTEXITCODE
