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
if ($ReportPath) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath)
    $env:UWA_INSTALL_TRACE = "$ReportPath.phases"
}
$watch = [Diagnostics.Stopwatch]::StartNew()
$process = Start-Process -FilePath $Installer -ArgumentList $arguments -PassThru
$samples = @()
$lastState = ''
$timedOut = $false
while (-not $process.WaitForExit(250)) {
    $state = "exe=$(Test-Path -LiteralPath (Join-Path $Destination 'Univer Workspace Agent.exe'));inventory=$(Test-Path -LiteralPath (Join-Path $Destination 'resources/runtime/integrity.json'))"
    if ($state -ne $lastState) { $samples += @{ elapsedMs = $watch.ElapsedMilliseconds; state = $state }; $lastState = $state }
    if ($watch.ElapsedMilliseconds -ge 60000) { $timedOut = $true; break }
}
if ($timedOut) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
}
$process.WaitForExit()
$watch.Stop()
Write-Output "Installation elapsed ms: $($watch.ElapsedMilliseconds)"
if ($ReportPath) {
    @{ elapsedMs = $watch.ElapsedMilliseconds; budgetMs = 30000; update = [bool]$Update; timedOut = $timedOut; exitCode = $process.ExitCode; samples = $samples } |
        ConvertTo-Json | Set-Content -LiteralPath $ReportPath -Encoding utf8
}
Remove-Item Env:UWA_INSTALL_TRACE -ErrorAction SilentlyContinue
if ($timedOut) { throw 'Installer exceeded 60 seconds' }
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
if (-not $DeferBudgetFailure -and $watch.ElapsedMilliseconds -gt 30000) {
    throw 'Installation exceeded the 30 second acceptance budget'
}
