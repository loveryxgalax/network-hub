param([ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Distribution = 'NetworkHub-ACS')
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtimePath = Join-Path $projectPath 'data\acs\runtime'
[IO.Directory]::CreateDirectory($runtimePath) | Out-Null
try { $lock = [IO.File]::Open((Join-Path $runtimePath 'host.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch [IO.IOException] { Write-Output 'The Network Hub ACS host is already running.'; exit 0 }
try {
    $wslPath = "$env:SystemRoot\System32\wsl.exe"
    & $wslPath --distribution $Distribution --user root --exec test -f /opt/network-hub-acs/install.json
    if ($LASTEXITCODE -ne 0) { throw 'The selected WSL distribution is not an installed Network Hub ACS host.' }
    # WSL follows the Windows clock. A competing Linux NTP correction can
    # invalidate live CWMP sessions by moving their expiry times by an hour.
    & $wslPath --distribution $Distribution --user root --exec systemctl --quiet disable --now systemd-timesyncd.service
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the competing Linux time service.' }
    $linuxEpoch = & $wslPath --distribution $Distribution --user root --exec date --utc +%s
    if ($LASTEXITCODE -ne 0 -or $linuxEpoch -notmatch '^\d+$') { throw 'Could not read the ACS host clock.' }
    $clockOffset = [long]$linuxEpoch - [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $clockAdjusted = [Math]::Abs($clockOffset) -gt 5
    if ($clockAdjusted) {
        $acsUtc = [DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss.fff')
        & $wslPath --distribution $Distribution --user root --exec date --utc --set $acsUtc 1>> (Join-Path $runtimePath 'host.stdout.log')
        if ($LASTEXITCODE -ne 0) { throw 'Could not align the ACS clock with Windows.' }
        & $wslPath --distribution $Distribution --user root --exec systemctl restart network-hub-acs-cwmp network-hub-acs-nbi
        if ($LASTEXITCODE -ne 0) { throw 'Could not restart ACS sessions after the clock correction.' }
    }
    [IO.File]::WriteAllText((Join-Path $runtimePath 'host.json'), (@{ supervisorPid = $PID; distribution = $Distribution; startedAt = [DateTime]::UtcNow.ToString('o'); clockOffsetBeforeSeconds = $clockOffset; clockAdjusted = $clockAdjusted; timeSource = 'Windows host; competing Linux NTP disabled' } | ConvertTo-Json))
    & "$env:SystemRoot\System32\wsl.exe" --distribution $Distribution --user root --exec /opt/network-hub-acs/keep-host.sh `
        1>> (Join-Path $runtimePath 'host.stdout.log') 2>> (Join-Path $runtimePath 'host.stderr.log')
    $result = $LASTEXITCODE
} finally { $lock.Dispose() }
exit $result
