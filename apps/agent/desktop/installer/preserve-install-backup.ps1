$ErrorActionPreference = 'Stop'
# A completed file install can be repaired even when data preparation failed.
# Never delete a backup or infer ownership from its directory name alone.
try {
    $installation = [IO.Path]::GetFullPath($env:UWA_INSTALL_DIRECTORY)
    $backup = "$installation.uwa-previous"
    if (-not (Test-Path -LiteralPath $backup)) { exit 0 }
    if ((Get-Content -Raw -LiteralPath "$installation/.uwa-install-committed") -ne '1') { exit 1 }
    $owner = Get-Content -Raw -Encoding Unicode -LiteralPath "$backup/.uwa-backup-owner"
    if ([IO.Path]::GetFullPath($owner) -ne $installation) { exit 1 }
    $archive = "$installation.uwa-recovery-$([guid]::NewGuid())"
    [IO.Directory]::Move($backup, $archive)
    if (Test-Path -LiteralPath "$backup.owner") {
        [IO.File]::Move("$backup.owner", "$archive.owner")
    }
    Write-Output "Previous program backup retained at $archive"
    exit 0
} catch {
    Write-Error -ErrorAction Continue 'Unable to preserve the previous program backup; installation remains blocked.'
    exit 1
}
