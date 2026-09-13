$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('uwa-installer-test-' + [Guid]::NewGuid())
$helper = Join-Path $PSScriptRoot '../installer/close-agent.ps1'
$powershell = Join-Path $PSHOME 'powershell.exe'
$processes = @()
try {
    foreach ($script in @($helper, (Join-Path $PSScriptRoot '../scripts/install-windows.ps1'))) {
        $tokens = $null
        $parseErrors = $null
        $null = [Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
    }
    $null = New-Item -ItemType Directory -Path (Join-Path $root 'installed'), (Join-Path $root 'other')
    $null = New-Item -ItemType Directory -Path (Join-Path $root 'installed/runtime')
    $app = Join-Path $root 'installed/Univer Workspace Agent.exe'
    $other = Join-Path $root 'other/Univer Workspace Agent.exe'
    $uninstaller = Join-Path $root 'installed/Uninstall Univer Workspace Agent.exe'
    Add-Type -OutputAssembly $app -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
public class Fixture {
    public static void Main(string[] args) {
        if (args.Length == 1) {
            using (var child = Process.Start(new ProcessStartInfo {
                FileName = Path.Combine(Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName), "runtime", "node.exe"),
                Arguments = "--child ignored", UseShellExecute = false, CreateNoWindow = true
            })) { File.WriteAllText(args[0], child.Id.ToString()); }
        }
        Thread.Sleep(45000);
    }
}
'@
    Copy-Item -LiteralPath $app -Destination $other
    Copy-Item -LiteralPath $app -Destination $uninstaller
    Copy-Item -LiteralPath $app -Destination (Join-Path $root 'installed/runtime/node.exe')
    Copy-Item -LiteralPath $app -Destination (Join-Path $root 'other/node.exe')
    $env:UWA_INSTALL_EXECUTABLE = $app
    & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper
    if ($LASTEXITCODE -ne 0) { throw 'Absent application should be accepted' }
    $pidFile = Join-Path $root 'child.pid'
    $owned = Start-Process -FilePath $app -ArgumentList ('"' + $pidFile + '"') -PassThru -WindowStyle Hidden
    $processes += $owned
    $unrelated = Start-Process -FilePath $other -PassThru -WindowStyle Hidden
    $processes += $unrelated
    $installer = Start-Process -FilePath $uninstaller -PassThru -WindowStyle Hidden
    $processes += $installer
    $unrelatedNode = Start-Process -FilePath (Join-Path $root 'other/node.exe') -PassThru -WindowStyle Hidden
    $processes += $unrelatedNode
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $pidFile)) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Fixture child did not start' }
        Start-Sleep -Milliseconds 50
    }
    $child = Get-Process -Id ([int](Get-Content -Raw -LiteralPath $pidFile))
    $processes += $child
    & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper
    if ($LASTEXITCODE -ne 10) { throw 'Running exact application was not detected' }
    if ($owned.HasExited -or $child.HasExited) { throw 'Detection must not stop the application' }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -Stop
    if ($LASTEXITCODE -ne 0) { throw 'Application shutdown failed' }
    if (-not $owned.WaitForExit(3000) -or -not $child.WaitForExit(3000)) { throw 'Owned process survived' }
    if ($unrelated.HasExited) { throw 'Same-name app in another installation was killed' }
    if ($unrelatedNode.HasExited) { throw 'Unrelated node.exe process was killed' }
    if ($installer.HasExited) { throw 'Uninstaller in the installation directory was killed' }
    & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -Stop
    if ($LASTEXITCODE -ne 0) { throw 'Repeated shutdown should be accepted' }
    Write-Output "Windows installer process isolation passed; shutdown and recheck $($watch.ElapsedMilliseconds) ms"
} finally {
    foreach ($process in $processes) {
        if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
        $process.Dispose()
    }
    Remove-Item Env:UWA_INSTALL_EXECUTABLE -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
