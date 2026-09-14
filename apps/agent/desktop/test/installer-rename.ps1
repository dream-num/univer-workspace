param([Parameter(Mandatory=$true)][string]$Fixture)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('uwa-rename-fixture-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory $root
try {
    $exe = Join-Path $root 'fixture.exe'
    Copy-Item -LiteralPath $Fixture -Destination $exe
    foreach ($scenario in @('success', 'extraction-failure', 'existing-backup')) {
        $fails = $scenario -eq 'extraction-failure'
        $destination = Join-Path $root "installed-$scenario"
        $null = New-Item -ItemType Directory $destination
        Set-Content -LiteralPath (Join-Path $destination 'old.txt') -Value 'old'
        if ($fails) { Set-Content -LiteralPath "$destination.fail" -Value 'fail' }
        if ($scenario -eq 'existing-backup') {
            $null = New-Item -ItemType Directory "$destination.uwa-previous"
            Set-Content "$destination.uwa-previous/old.txt" 'previous'
            [IO.File]::WriteAllText("$destination.uwa-previous/.uwa-backup-owner", $destination, [Text.Encoding]::Unicode)
        }
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $child = Start-Process -FilePath $exe -ArgumentList @('/S', "/D=$destination") -PassThru
        if (-not $child.WaitForExit(60000)) {
            & "$env:SystemRoot\System32\taskkill.exe" /PID $child.Id /T /F | Out-Null
            throw "Directory replacement fixture timed out: $scenario"
        }
        Write-Output "$scenario fixture: $($watch.ElapsedMilliseconds) ms; exit $($child.ExitCode)"
        if ($scenario -eq 'existing-backup') {
            if ($child.ExitCode -eq 0 -or (Get-Content -Raw "$destination/old.txt").Trim() -ne 'old' -or
                (Get-Content -Raw "$destination.uwa-previous/old.txt").Trim() -ne 'previous' -or
                (Test-Path "$destination/new.txt") -or (Test-Path "$destination.uwa-failed")) {
                throw 'An existing backup must leave both installations untouched'
            }
            continue
        }
        if ($fails) {
            if (-not (Test-Path "$destination/old.txt") -or (Test-Path "$destination/new.txt")) { throw 'Failed install did not restore old files' }
        } else {
            if ($child.ExitCode -ne 0 -or -not (Test-Path "$destination/new.txt") -or -not (Test-Path "$destination.uwa-previous/old.txt")) { throw 'Successful replacement lost the old backup' }
            $owner = Get-Content -Raw -Encoding Unicode "$destination.uwa-previous/.uwa-backup-owner"
            if ($owner -ne $destination) { throw 'Backup owner marker is not portable Unicode' }
        }
        $trace = Get-Content "$destination.uwa-install.log"
        if (-not ($trace -match '^rename-old-complete:\d+')) { throw 'Native rename timing was not emitted' }
        if ($fails -and -not ($trace -match '^restore-old-complete:\d+')) { throw 'Native recovery timing was not emitted' }
    }
    Write-Output 'Native NSIS directory replacement and failure recovery passed'
} finally {
    Get-ChildItem -LiteralPath $root -Filter '*.uwa-install.log' | ForEach-Object {
        Write-Output "Native phases: $($_.Name)"
        Get-Content -LiteralPath $_.FullName
    }
    Remove-Item -LiteralPath $root -Recurse -Force
}
