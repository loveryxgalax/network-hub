param(
    [string]$EnvironmentFile = '.env.cloudflare',
    [string]$CloudflaredPath = 'cloudflared',
    [string]$NodePath = 'node',
    [ValidateRange(2, 60)][int]$CheckSeconds = 5
)
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$serverPath = Join-Path $projectPath 'server.cjs'
$configPath = Join-Path $projectPath 'deployment\cloudflare.local.yml'
$envPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $projectPath $EnvironmentFile }
$nodeExe = (Get-Command $NodePath -ErrorAction Stop).Source
$tunnelExe = (Get-Command $CloudflaredPath -ErrorAction Stop).Source
foreach ($requiredPath in @($serverPath, $configPath, $envPath)) {
    if (!(Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "Missing runtime file: $requiredPath" }
}
$configText = Get-Content -LiteralPath $configPath -Raw
$hostnameMatch = [regex]::Match($configText, '(?m)^\s+- hostname: ([a-z0-9.-]+)\s*$')
if (!$hostnameMatch.Success) { throw 'The tunnel configuration needs a published hostname.' }
$publicOrigin = 'https://' + $hostnameMatch.Groups[1].Value
$envLines = @(Get-Content -LiteralPath $envPath | ForEach-Object { $_.Trim() })
if (!($envLines -contains ('NETWORK_PUBLIC_ORIGIN=' + $publicOrigin))) {
    throw 'The environment public origin does not match the tunnel hostname.'
}
if (!($envLines -contains 'HOST=127.0.0.1') -or !($envLines -contains 'PORT=4317')) {
    throw 'This supervisor requires the dashboard on loopback 127.0.0.1:4317.'
}
$runtimePath = Join-Path $projectPath 'data\runtime'
[IO.Directory]::CreateDirectory($runtimePath) | Out-Null
$lockPath = Join-Path $runtimePath 'supervisor.lock'
try { $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch [IO.IOException] { Write-Output 'Network Hub supervisor is already running.'; exit 0 }
$operationLog = Join-Path $runtimePath 'supervisor.log'
$statePath = Join-Path $runtimePath 'status.json'
$stopPath = Join-Path $runtimePath 'stop.request'
$startedAt = [DateTime]::UtcNow.ToString('o')
$roles = @{}
$failure = $null
function Write-Operation([string]$Message) {
    if ((Test-Path -LiteralPath $operationLog) -and (Get-Item -LiteralPath $operationLog).Length -gt 4194304) {
        $previousLog = $operationLog + '.previous'
        if (Test-Path -LiteralPath $previousLog) { Remove-Item -LiteralPath $previousLog -Force }
        Move-Item -LiteralPath $operationLog -Destination $previousLog
    }
    [IO.File]::AppendAllText($operationLog, ([DateTime]::UtcNow.ToString('o') + ' ' + $Message + [Environment]::NewLine))
}
function Test-Alive($Process) {
    if ($null -eq $Process) { return $false }
    try { $Process.Refresh(); return !$Process.HasExited } catch { return $false }
}
function Find-Existing([string]$Name) {
    $exe = if ($Name -eq 'dashboard') { $nodeExe } else { $tunnelExe }
    $needle = if ($Name -eq 'dashboard') { $serverPath } else { $configPath }
    $processName = [IO.Path]::GetFileName($exe)
    $matches = @(Get-CimInstance Win32_Process -Filter ("Name='" + $processName + "'") | Where-Object {
        $_.ExecutablePath -eq $exe -and $_.CommandLine -and
        $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        ($Name -ne 'dashboard' -or $_.CommandLine.IndexOf($envPath, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
    if ($matches.Count -gt 1) { throw "Multiple $Name processes use this project's configuration. Resolve the duplicates first." }
    if ($matches.Count -eq 1) { return Get-Process -Id $matches[0].ProcessId -ErrorAction SilentlyContinue }
    return $null
}
function Start-Role([string]$Name) {
    $entry = $roles[$Name]
    if ([DateTime]::UtcNow -lt $entry.NextStart) { return }
    foreach ($stream in @('stdout', 'stderr')) {
        $logPath = Join-Path $runtimePath ($Name + '.' + $stream + '.log')
        if (Test-Path -LiteralPath $logPath) {
            $oldPath = $logPath + '.previous'
            if (Test-Path -LiteralPath $oldPath) { Remove-Item -LiteralPath $oldPath -Force }
            Move-Item -LiteralPath $logPath -Destination $oldPath
        }
    }
    $exe = if ($Name -eq 'dashboard') { $nodeExe } else { $tunnelExe }
    $arguments = if ($Name -eq 'dashboard') { '--env-file="{0}" "{1}"' -f $envPath, $serverPath } else { 'tunnel --config "{0}" run' -f $configPath }
    $entry.Process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimePath ($Name + '.stdout.log')) -RedirectStandardError (Join-Path $runtimePath ($Name + '.stderr.log'))
    $entry.Managed = $true
    $entry.LastStart = [DateTime]::UtcNow
    $entry.Restarts++
    Write-Operation ("Started $Name pid=" + $entry.Process.Id)
}
function Update-Role([string]$Name, [bool]$AllowStart) {
    $entry = $roles[$Name]
    if ($null -ne $entry.Process -and !(Test-Alive $entry.Process)) {
        $exitCode = try { $entry.Process.ExitCode } catch { 'unknown' }
        Write-Operation ("$Name exited code=" + $exitCode)
        if (([DateTime]::UtcNow - $entry.LastStart).TotalSeconds -lt 60) { $entry.Failures++ } else { $entry.Failures = 0 }
        $entry.NextStart = [DateTime]::UtcNow.AddSeconds([Math]::Min(60, 5 * [Math]::Pow(2, [Math]::Min(4, $entry.Failures))))
        $entry.Process.Dispose()
        $entry.Process = $null
    }
    if ($AllowStart -and $null -eq $entry.Process) { Start-Role $Name }
}
function Save-State([bool]$AppReady, [string]$Message) {
    $processStates = @{}
    foreach ($name in @('dashboard', 'tunnel')) {
        $entry = $roles[$name]
        $processStates[$name] = @{ pid = $(if (Test-Alive $entry.Process) { $entry.Process.Id } else { $null }); running = (Test-Alive $entry.Process); startedBySupervisor = $entry.Managed; starts = $entry.Restarts }
    }
    $state = @{ supervisorPid = $PID; startedAt = $startedAt; updatedAt = [DateTime]::UtcNow.ToString('o'); publicOrigin = $publicOrigin; appReady = $AppReady; processes = $processStates; message = $Message }
    $temporaryPath = $statePath + '.new'
    [IO.File]::WriteAllText($temporaryPath, ($state | ConvertTo-Json -Depth 5))
    Move-Item -LiteralPath $temporaryPath -Destination $statePath -Force
}
try {
    & $tunnelExe tunnel --config $configPath ingress validate | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare ingress validation failed.' }
    foreach ($name in @('dashboard', 'tunnel')) {
        $process = Find-Existing $name
        $roles[$name] = @{ Process = $process; Managed = $false; Restarts = 0; Failures = 0; NextStart = [DateTime]::UtcNow; LastStart = [DateTime]::UtcNow }
        if ($null -ne $process) { Write-Operation ("Adopted existing $name pid=" + $process.Id) }
    }
    Write-Operation ('Supervisor started pid=' + $PID)
    while (!(Test-Path -LiteralPath $stopPath)) {
        Update-Role 'dashboard' $true
        $appReady = $false
        $message = ''
        try {
            $session = Invoke-RestMethod -Uri 'http://127.0.0.1:4317/api/session' -TimeoutSec 3
            if ($session.setup) { $message = 'Create the owner account locally before opening the tunnel.' }
            elseif ($session.publicOrigin -ne $publicOrigin) { $message = 'Running app public origin differs from the tunnel hostname.' }
            else { $appReady = $true }
        } catch { $message = 'Waiting for the local dashboard.' }
        Update-Role 'tunnel' $appReady
        Save-State $appReady $message
        Start-Sleep -Seconds $CheckSeconds
    }
    Write-Operation 'Stop requested. Supervisor is leaving existing app and tunnel processes running.'
    Save-State $false 'Supervisor stopped by request; app and tunnel processes were left running.'
} catch {
    $failure = $_
    Write-Operation ('Supervisor error: ' + $_.Exception.Message)
} finally {
    $lock.Dispose()
}
if ($null -ne $failure) { throw $failure }
