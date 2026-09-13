param([Parameter(Mandatory=$true)][string]$Installer,
      [Parameter(Mandatory=$true)][string]$Destination,
      [switch]$Update,
      [string]$ReportPath,
      [switch]$DeferBudgetFailure)
$ErrorActionPreference = 'Stop'
if ($DeferBudgetFailure -and -not $ReportPath) { throw 'Deferred acceptance requires a report path' }
$arguments = @('/S')
if ($Update) { $arguments += '--updated' }
# NSIS requires /D to be the last argument, without quotes around its value.
$arguments += "/D=$Destination"
$watch = [Diagnostics.Stopwatch]::StartNew()
$process = Start-Process -FilePath $Installer -ArgumentList $arguments -PassThru
if (-not $process.WaitForExit(60000)) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
    throw 'Installer exceeded 60 seconds'
}
$process.WaitForExit()
$watch.Stop()
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
Write-Output "Installation elapsed ms: $($watch.ElapsedMilliseconds)"
if ($ReportPath) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath)
    @{ elapsedMs = $watch.ElapsedMilliseconds; budgetMs = 30000; update = [bool]$Update } |
        ConvertTo-Json | Set-Content -LiteralPath $ReportPath -Encoding utf8
}
if (-not $DeferBudgetFailure -and $watch.ElapsedMilliseconds -gt 30000) {
    throw 'Installation exceeded the 30 second acceptance budget'
}
