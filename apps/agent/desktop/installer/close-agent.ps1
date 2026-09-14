param([switch]$Stop)
$ErrorActionPreference = 'Stop'
try {
    # The NSIS host passes the exact executable path as data, never PS source.
    $executable = [IO.Path]::GetFullPath($env:UWA_INSTALL_EXECUTABLE)
    # Avoid initializing WMI on a fresh installation with no candidate process.
    if (-not (Get-Process -Name 'Univer Workspace Agent' -ErrorAction SilentlyContinue)) { exit 0 }
    $matches = @(Get-CimInstance Win32_Process -Filter "Name = 'Univer Workspace Agent.exe'" |
        Where-Object { $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $executable, [StringComparison]::OrdinalIgnoreCase) })
    if (-not $matches.Count) { exit 0 }
    if (-not $Stop) { exit 10 }
    # Snapshot descendants before asking the old window to close: a launcher
    # can exit first and leave Node/Chromium orphans with locked runtime files.
    $all = @(Get-CimInstance Win32_Process)
    $owned = @{}
    foreach ($entry in $matches) { $owned[[int]$entry.ProcessId] = $entry }
    do {
        $added = $false
        foreach ($entry in $all) {
            if ($owned.ContainsKey([int]$entry.ParentProcessId) -and -not $owned.ContainsKey([int]$entry.ProcessId)) {
                $owned[[int]$entry.ProcessId] = $entry
                $added = $true
            }
        }
    } while ($added)
    # Terminate each app-owned tree, including standalone Node/DSH children.
    # Do not match all processes below INSTDIR: that also matches uninstallers.
    foreach ($entry in $matches) {
        $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
        if ($process) { $null = $process.CloseMainWindow() }
    }
    Start-Sleep -Milliseconds 500
    foreach ($entry in $owned.Values) {
        $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.ProcessId)"
        if ($current -and $current.CreationDate -eq $entry.CreationDate) {
            $killer = New-Object Diagnostics.Process
            $killer.StartInfo.FileName = "$env:SystemRoot\System32\taskkill.exe"
            $killer.StartInfo.Arguments = "/PID $($entry.ProcessId) /T /F"
            $killer.StartInfo.UseShellExecute = $false
            $killer.StartInfo.CreateNoWindow = $true
            $killer.StartInfo.RedirectStandardOutput = $true
            $killer.StartInfo.RedirectStandardError = $true
            $null = $killer.Start()
            if (-not $killer.WaitForExit(4000)) { $killer.Kill() }
            $killer.Dispose()
            # A process can exit between the snapshot and taskkill. The final
            # identity check below decides success, not taskkill's race exit code.
        }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        $remaining = @(Get-CimInstance Win32_Process | Where-Object {
            $owned.ContainsKey([int]$_.ProcessId) -and $owned[[int]$_.ProcessId].CreationDate -eq $_.CreationDate
        })
        if (-not $remaining.Count) { exit 0 }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    exit 1
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
