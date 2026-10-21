param([ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Distribution = 'NetworkHub-ACS', [switch]$StartNow)
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $PSScriptRoot 'start-acs-host.ps1'
$powershellPath = (Get-Command powershell.exe).Source
$taskName = 'Kade Network Hub ACS'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -Distribution "{1}"' -f $launcher, $Distribution
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and !($existing.Actions | Where-Object { $_.Arguments -and $_.Arguments.Contains($launcher) })) { throw 'The ACS task name belongs to another application.' }
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $projectPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval ([TimeSpan]::FromMinutes(1))
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Keep the dedicated NetworkHub-ACS WSL environment and its private services running.' -Force | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $taskName }
$runtimePath = Join-Path $projectPath 'data\acs\runtime'
[IO.Directory]::CreateDirectory($runtimePath) | Out-Null
$receipt = @{ taskName = $taskName; distribution = $Distribution; installedAt = [DateTime]::UtcNow.ToString('o'); startsBeforeSignIn = $false; restartInterval = 'one minute after failure'; user = $user }
$receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimePath 'startup.json') -Encoding UTF8
$receipt | ConvertTo-Json
