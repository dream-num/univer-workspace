param([Parameter(Mandatory=$true)][string]$Installer,
      [Parameter(Mandatory=$true)][string]$Destination,
      [switch]$Update,
      [string]$ReportPath,
      [switch]$DeferBudgetFailure,
      [int]$WatchdogMs = 180000)
$ErrorActionPreference = 'Stop'
if ($DeferBudgetFailure -and -not $ReportPath) { throw 'Deferred acceptance requires a report path' }
$arguments = @('/S')
if ($Update) { $arguments += '--updated' }
# NSIS requires /D to be the last argument, without quotes around its value.
$arguments += "/D=$Destination"
if ($ReportPath) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath)
    $env:UWA_INSTALL_TRACE = "$ReportPath.phases"
}
$trace = "$Destination.uwa-install.log"
Remove-Item -LiteralPath $trace -ErrorAction SilentlyContinue
$startTick = [Environment]::TickCount
$watch = [Diagnostics.Stopwatch]::StartNew()
$process = Start-Process -FilePath $Installer -ArgumentList $arguments -PassThru
$samples = @()
$lastState = ''
$timedOut = $false
while (-not $process.WaitForExit(250)) {
    $state = "exe=$(Test-Path -LiteralPath (Join-Path $Destination 'Univer Workspace Agent.exe'));inventory=$(Test-Path -LiteralPath (Join-Path $Destination 'resources/runtime/integrity.json'))"
    if ($state -ne $lastState) { $samples += @{ elapsedMs = $watch.ElapsedMilliseconds; state = $state }; $lastState = $state }
    if ($watch.ElapsedMilliseconds -ge $WatchdogMs) { $timedOut = $true; break }
}
if ($timedOut) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
}
$process.WaitForExit()
$watch.Stop()
Write-Output "Installation elapsed ms: $($watch.ElapsedMilliseconds)"
if ($ReportPath) {
    $phases = @()
    if (Test-Path -LiteralPath $trace) {
        Copy-Item -LiteralPath $trace -Destination "$ReportPath.phases"
        foreach ($line in Get-Content -LiteralPath $trace) {
            if ($line -match '^([^:]+):(-?\d+)$') {
                $elapsed = ([long]$Matches[2] - [long]$startTick + 4294967296) % 4294967296
                $phases += @{ phase = $Matches[1]; elapsedMs = $elapsed }
            }
        }
    }
    @{ elapsedMs = $watch.ElapsedMilliseconds; budgetMs = 40000; update = [bool]$Update; timedOut = $timedOut; exitCode = $process.ExitCode; samples = $samples; phases = $phases } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportPath -Encoding utf8
}
Remove-Item Env:UWA_INSTALL_TRACE -ErrorAction SilentlyContinue
if ($timedOut) { throw "Installer exceeded $WatchdogMs ms diagnostic watchdog" }
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
if (-not $DeferBudgetFailure -and $watch.ElapsedMilliseconds -gt 40000) {
    throw 'Installation exceeded the 30 second acceptance budget'
}
