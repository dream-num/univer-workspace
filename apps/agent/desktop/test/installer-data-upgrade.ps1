param([Parameter(Mandatory=$true)][string]$Fixture)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('uwa-data-installer-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory $root
try {
    $exe = Join-Path $root 'fixture.exe'
    Copy-Item -LiteralPath $Fixture -Destination $exe
    $runner = Join-Path $root 'MigrationFixture.exe'
    Add-Type -OutputAssembly $runner -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
public class MigrationFixture {
    public static int Main(string[] args) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        File.AppendAllText(Path.Combine(root, "called.txt"), String.Join(" ", args) + Environment.NewLine);
        return Int32.Parse(File.ReadAllText(Path.Combine(root, "result.txt")));
    }
}
'@
    foreach ($scenario in @('success', 'failed', 'deferred', 'reopen')) {
        $destination = Join-Path $root $scenario
        $null = New-Item -ItemType Directory $destination
        Copy-Item $runner (Join-Path $destination 'MigrationFixture.exe')
        Set-Content (Join-Path $destination 'result.txt') $(if ($scenario -in @('failed', 'reopen')) { '21' } else { '0' })
        Set-Content (Join-Path $destination 'new-program.txt') 'new'
        $null = New-Item -ItemType Directory "$destination.uwa-previous"
        Set-Content "$destination.uwa-previous/old-program.txt" 'old'
        [IO.File]::WriteAllText("$destination.uwa-previous/.uwa-backup-owner", $destination, [Text.Encoding]::Unicode)
        $arguments = @('/S')
        if ($scenario -eq 'deferred') { $arguments += '/DEFERDATAMIGRATION' }
        if ($scenario -eq 'reopen') { $arguments += '/FORCERUN' }
        $arguments += "/D=$destination"
        $child = Start-Process $exe -ArgumentList $arguments -PassThru
        if (-not $child.WaitForExit(30000)) { $child.Kill(); throw 'Installer migration fixture timed out' }
        $expected = if ($scenario -in @('failed', 'reopen')) { 21 } else { 0 }
        if ($child.ExitCode -ne $expected) { throw "Wrong installer result for ${scenario}: $($child.ExitCode)" }
        if (-not (Test-Path "$destination/new-program.txt") -or -not (Test-Path "$destination.uwa-previous/old-program.txt")) {
            throw 'Data migration failure must not invoke program-file rollback'
        }
        if ($scenario -eq 'deferred') {
            if (Test-Path "$destination/called.txt") { throw 'Deferred migration touched user data' }
        } elseif (@(Get-Content "$destination/called.txt")[0] -ne '--migrate-data-only --migration-headless') {
            throw 'Installer did not use the headless data migration entry'
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
    }
    Write-Output 'Native NSIS data upgrade success, failure without binary rollback, deferred migration, and automatic-update reopening passed'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
