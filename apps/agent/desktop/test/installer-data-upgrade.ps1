param([Parameter(Mandatory=$true)][string]$Fixture)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('uwa-data-installer-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory $root
try {
    $exe = Join-Path $root 'fixture.exe'
    Copy-Item -LiteralPath $Fixture -Destination $exe
    $payload = Join-Path $root 'payload'
    $null = New-Item -ItemType Directory $payload
    $runner = Join-Path $payload 'MigrationFixture.exe'
    Add-Type -OutputAssembly $runner -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
public class MigrationFixture {
    public static int Main(string[] args) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        File.AppendAllText(Path.Combine(root, "called.txt"), String.Join(" ", args) + Environment.NewLine);
        foreach (string arg in args) {
            if (arg.StartsWith("--migration-result-file=") && File.Exists(Path.Combine(root, "proof.txt")))
                File.WriteAllText(arg.Substring("--migration-result-file=".Length), "unchanged");
        }
        return Int32.Parse(File.ReadAllText(Path.Combine(root, "result.txt")));
    }
}
'@
    function Install-Fixture($destination, $options = @()) {
        $child = Start-Process $exe -ArgumentList (@('/S') + $options + "/D=$destination") -PassThru
        if (-not $child.WaitForExit(30000)) { $child.Kill(); throw 'Installer migration fixture timed out' }
        return $child.ExitCode
    }
    foreach ($scenario in @('success', 'failed', 'unknown', 'deferred', 'reopen')) {
        $destination = Join-Path $root $scenario
        $null = New-Item -ItemType Directory $destination
        Set-Content "$destination/old-program.txt" 'old'
        Set-Content "$destination.registration" 'old'
        Set-Content "$payload/result.txt" $(if ($scenario -in @('failed', 'unknown', 'reopen')) { '21' } else { '0' })
        Set-Content "$payload/new-program.txt" 'new'
        Remove-Item "$payload/proof.txt" -ErrorAction SilentlyContinue
        if ($scenario -eq 'failed') { Set-Content "$payload/proof.txt" 'unchanged' }
        $options = @()
        if ($scenario -eq 'deferred') { $options += '/DEFERDATAMIGRATION' }
        if ($scenario -eq 'reopen') { $options += '/FORCERUN' }
        $code = Install-Fixture $destination $options
        if ($scenario -eq 'failed') {
            if ($code -eq 0 -or -not (Test-Path "$destination/old-program.txt") -or (Test-Path "$destination/new-program.txt") -or
                (Get-Content -Raw "$destination.registration").Trim() -ne 'old') { throw 'Confirmed unchanged data did not restore old program and retain registration' }
            if (Test-Path "$destination.uwa-previous") { throw 'Rollback left a blocking program backup' }
        } else {
            $expected = if ($scenario -in @('unknown', 'reopen')) { 21 } else { 0 }
            if ($code -ne $expected) { throw "Wrong installer result for ${scenario}: $code" }
            if (-not (Test-Path "$destination/new-program.txt") -or -not (Test-Path "$destination.uwa-previous/old-program.txt")) {
                throw 'Unknown data state must retain both program trees'
            }
            if ($scenario -eq 'deferred') {
                if (Test-Path "$destination/called.txt") { throw 'Deferred migration touched user data' }
            } elseif (@(Get-Content "$destination/called.txt")[0] -notmatch '^--migrate-data-only --migration-headless --migration-result-file=') {
                throw 'Installer did not pass a private migration receipt path'
            }
        }
        if ($scenario -eq 'reopen') {
            $deadline = [DateTime]::UtcNow.AddSeconds(10)
            do {
                $calls = @([IO.File]::ReadAllLines("$destination/called.txt"))
                if ($calls.Count -ge 2) { break }
                Start-Sleep -Milliseconds 100
            } while ([DateTime]::UtcNow -lt $deadline)
            if ($calls.Count -ne 2 -or $calls[1] -ne '') { throw 'Failed automatic update did not reopen the normal application' }
            Get-Process -Name MigrationFixture -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq "$destination\MigrationFixture.exe" } |
                ForEach-Object { if (-not $_.WaitForExit(5000)) { throw 'Migration fixture did not exit' } }
        }
        if ($scenario -in @('failed', 'unknown', 'deferred')) {
            Set-Content "$payload/result.txt" '0'
            Remove-Item "$payload/proof.txt" -ErrorAction SilentlyContinue
            if ((Install-Fixture $destination) -ne 0 -or -not (Test-Path "$destination/new-program.txt")) {
                throw "Repair installation blocked after $scenario"
            }
            if ($scenario -ne 'failed') {
                $archives = @(Get-ChildItem -LiteralPath $root -Directory -Filter "$scenario.uwa-recovery-*")
                if ($archives.Count -ne 1 -or -not (Test-Path "$($archives[0].FullName)/old-program.txt")) {
                    throw 'Repair lost the original program backup'
                }
            }
        }
    }
    Write-Output 'Native NSIS: unchanged-data rollback, retained registration, unknown-state preservation, retry/repair installation, deferral and reopening passed'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
