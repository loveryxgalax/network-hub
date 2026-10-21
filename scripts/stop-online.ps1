param([string]$TaskName = 'Kade Network Hub')
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$supervisorPath = Join-Path $PSScriptRoot 'keep-online.ps1'
$runtimePath = Join-Path $projectPath 'data\runtime'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task -and !($task.Actions | Where-Object { $_.Arguments -and $_.Arguments.Contains($supervisorPath) })) {
    throw 'Refusing to stop a scheduled task that belongs to another application.'
}
[IO.Directory]::CreateDirectory($runtimePath) | Out-Null
[IO.File]::WriteAllText((Join-Path $runtimePath 'stop.request'), 'Maintenance requested at ' + [DateTime]::UtcNow.ToString('o'))
if ($task) { Stop-ScheduledTask -TaskName $TaskName }
# Stop only processes whose arguments contain this project's exact runtime files.
$needles = @($supervisorPath, (Join-Path $projectPath 'server.cjs'), (Join-Path $projectPath 'deployment\cloudflare.local.yml'))
$stopped = @()
foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='node.exe' OR Name='cloudflared.exe'")) {
    if (!$process.CommandLine) { continue }
    foreach ($needle in $needles) {
        if ($process.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            # The supervisor path is supplied only to its own PowerShell process;
            # the server and tunnel config are supplied only to their respective executables.
            $correctRole = ($needle -eq $supervisorPath -and $process.Name -eq 'powershell.exe') -or
                ($needle -like '*\server.cjs' -and $process.Name -eq 'node.exe') -or
                ($needle -like '*\cloudflare.local.yml' -and $process.Name -eq 'cloudflared.exe')
            if ($correctRole) {
                $running = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
                if ($running) {
                    Stop-Process -Id $running.Id -ErrorAction Stop
                    $running.WaitForExit(10000) | Out-Null
                    $stopped += $running.Id
                }
            }
            break
        }
    }
}
@{ stopped = $true; processIds = $stopped; maintenanceFlag = (Join-Path $runtimePath 'stop.request'); resume = 'Run install-online-startup.ps1 -CloudflaredPath YOUR_CLOUDFLARED_PATH -StartNow' } | ConvertTo-Json
