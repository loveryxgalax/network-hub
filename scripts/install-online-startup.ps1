param(
    [string]$CloudflaredPath = 'cloudflared',
    [string]$EnvironmentFile = '.env.cloudflare',
    [string]$TaskName = 'Kade Network Hub',
    [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$supervisorPath = Join-Path $PSScriptRoot 'keep-online.ps1'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$tunnelPath = (Get-Command $CloudflaredPath -ErrorAction Stop).Source
$powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$envPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $projectPath $EnvironmentFile }
$runtimePath = Join-Path $projectPath 'data\runtime'
[IO.Directory]::CreateDirectory($runtimePath) | Out-Null
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -EnvironmentFile "{1}" -CloudflaredPath "{2}" -NodePath "{3}"' -f $supervisorPath, $envPath, $tunnelPath, $nodePath
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$installedAs = $null
$registrationError = $null
try {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing -and !($existing.Actions | Where-Object { $_.Arguments -and $_.Arguments.Contains($supervisorPath) })) { throw 'The task name is already used by another application.' }
    $action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $projectPath
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval ([TimeSpan]::FromMinutes(1))
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description ('Network Hub runtime supervisor for ' + $projectPath) -Force | Out-Null
    $installedAs = 'Scheduled task at Windows sign-in'
} catch {
    if ($_.Exception.Message -eq 'The task name is already used by another application.') { throw }
    $registrationError = $_.Exception.Message
    $startupPath = [Environment]::GetFolderPath('Startup')
    if (!$startupPath) { throw 'Windows did not return this user''s Startup folder.' }
    $shortcutPath = Join-Path $startupPath 'Kade Network Hub.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.Description -ne 'Network Hub runtime supervisor') { throw 'The Startup shortcut name is already used by another application.' }
    $shortcut.TargetPath = $powershellPath
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $projectPath
    $shortcut.Description = 'Network Hub runtime supervisor'
    $shortcut.Save()
    $installedAs = 'Startup shortcut at Windows sign-in'
}
$receipt = @{ installedAt = [DateTime]::UtcNow.ToString('o'); method = $installedAs; user = $user; taskName = $TaskName; project = $projectPath; startsBeforeSignIn = $false; schedulerRegistrationError = $registrationError }
$receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimePath 'startup.json') -Encoding UTF8
if ($StartNow) {
    $stopPath = Join-Path $runtimePath 'stop.request'
    if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath -Force }
    if ($installedAs -like 'Scheduled task*') { Start-ScheduledTask -TaskName $TaskName }
    else { Start-Process -FilePath $powershellPath -ArgumentList $arguments -WorkingDirectory $projectPath -WindowStyle Hidden | Out-Null }
}
$receipt | ConvertTo-Json
