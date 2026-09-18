; Override builder's directory-prefix process matching, which can include the
; uninstaller itself. Keep consent/retry behavior, and scope kills to this app.
!macro agentInstallTrace PHASE
  Push $R6
  StrCpy $R6 0
  ${If} ${Errors}
    StrCpy $R6 1
  ${EndIf}
  Push $R7
  Push $R8
  Push $R9
  ; A sibling log survives both directory activation and NSIS subprocesses.
  ; Do not rely on inherited environment variables across elevation/launchers.
  StrCpy $R7 "$INSTDIR.uwa-install.log"
  System::Call 'kernel32::GetTickCount() i.R9'
  FileOpen $R8 "$R7" a
  FileSeek $R8 0 END
  FileWrite $R8 "${PHASE}:$R9$\r$\n"
  FileClose $R8
  Pop $R9
  Pop $R8
  Pop $R7
  ${If} $R6 == 1
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
  Pop $R6
!macroend

!macro customUnInstall
  !insertmacro agentInstallTrace "uninstall-files-start"
!macroend

; Keep the backup on the installation volume, outside the temporary uninstaller
; directory. A failed or interrupted installer must leave old binaries recoverable.
!macro agentRenameInstallation
    SetOutPath $TEMP
    !insertmacro agentInstallTrace "rename-old-start"
    ${If} ${FileExists} "$INSTDIR.uwa-previous\*.*"
      !insertmacro agentInstallTrace "backup-already-exists"
      Abort "Previous installation backup requires recovery before another update."
    ${EndIf}
    ; Process exit can precede release of Windows image/directory handles.
    ; Retry only this same-volume rename, bounded to 40 attempts; never delete
    ; files or invoke the broken legacy uninstaller as a fallback.
    StrCpy $R7 0
    ${Do}
      ClearErrors
      Rename "$INSTDIR" "$INSTDIR.uwa-previous"
      ${IfNot} ${Errors}
        ${ExitDo}
      ${EndIf}
      System::Call 'kernel32::GetLastError() i.R5'
      !insertmacro agentInstallTrace "rename-old-error-$R5"
      IntOp $R7 $R7 + 1
      ${If} $R7 >= 40
        !insertmacro agentInstallTrace "rename-old-failed"
        Abort "Cannot move the old installation; its files were left in place."
      ${EndIf}
      !insertmacro agentInstallTrace "rename-old-retry"
      Sleep 100
    ${Loop}
    !insertmacro agentInstallTrace "rename-old-complete"
    FileOpen $R8 "$INSTDIR.uwa-previous\.uwa-backup-owner" w
    FileWriteUTF16LE /BOM $R8 "$INSTDIR"
    FileClose $R8
!macroend

; Alpha.3's uninstaller can reject its own process and report "cannot close".
; Migrate only that known release at the same installation path. The parent
; already closed owned processes; retain its registration until commit.
; Remove after the alpha.3 upgrade support window ends.
!macro agentMigrateAlpha3 VERSION DIRECTORY
  ${If} "${VERSION}" == "0.1.0-alpha.3"
  ${AndIf} "${DIRECTORY}" == "$INSTDIR"
  ${AndIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro agentInstallTrace "migrate-alpha3-start"
    !insertmacro agentRenameInstallation
    !insertmacro agentInstallTrace "migrate-alpha3-complete"
    ClearErrors
    StrCpy $R0 0
    Return
  ${EndIf}
!macroend

!macro customRemoveFiles
  SetOutPath $TEMP
  ${If} ${isUpdated}
    !insertmacro agentRenameInstallation
    ; Keep the old registration until the parent installer commits the new one.
    ; In particular do not let the temporary uninstaller delete this backup.
    SetErrorLevel 0
    Quit
  ${Else}
    !insertmacro agentInstallTrace "remove-files-start"
    RMDir /r "$INSTDIR"
    !insertmacro agentInstallTrace "remove-files-complete"
  ${EndIf}
!macroend

!macro customInit
  !insertmacro agentInstallTrace "installer-init"
!macroend

!macro customUnInit
  !insertmacro agentInstallTrace "uninstaller-init"
!macroend

!macro agentExtractionFailed
  !insertmacro agentInstallTrace "extract-failed"
  SetErrorLevel 2
  ; Unlike Quit, Abort invokes .onInstFailed and restores this attempt's backup.
  Abort "Unable to extract the new installation."
!macroend

; Builder includes this file before LogicLib. Expand the callback only at the
; supported header hook, after the standard NSIS libraries have been loaded.
!macro customHeader
!ifndef BUILD_UNINSTALLER
Function .onInstFailed
  ${If} ${FileExists} "$INSTDIR.uwa-previous\.uwa-backup-owner"
    !insertmacro agentInstallTrace "restore-old-start"
    SetOutPath $TEMP
    ${If} ${FileExists} "$INSTDIR\*.*"
      StrCpy $R7 "$INSTDIR.uwa-failed"
      StrCpy $R6 0
      ${DoWhile} ${FileExists} "$R7\*.*"
        IntOp $R6 $R6 + 1
        StrCpy $R7 "$INSTDIR.uwa-failed-$R6"
      ${Loop}
      ClearErrors
      Rename "$INSTDIR" "$R7"
      ${If} ${Errors}
        !insertmacro agentInstallTrace "restore-cannot-move-partial-install"
        Return
      ${EndIf}
    ${EndIf}
    ClearErrors
    Rename "$INSTDIR.uwa-previous" "$INSTDIR"
    ${If} ${Errors}
      !insertmacro agentInstallTrace "restore-old-failed"
    ${Else}
      !insertmacro agentInstallTrace "restore-old-complete"
    ${EndIf}
  ${EndIf}
FunctionEnd
!endif
!macroend

Var /GLOBAL uwaMigrationStatus

!macro customInstall
  ; Registration and shortcuts have committed. This marker distinguishes a
  ; usable replacement (including deferred/failed data preparation) from partial
  ; extraction. A later repair installer may archive its old backup safely.
  FileOpen $R8 "$INSTDIR\.uwa-install-committed" w
  FileWrite $R8 "1"
  FileClose $R8
  !insertmacro agentInstallTrace "install-files-complete"
  ${If} $uwaMigrationStatus != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Program files are installed, but local data preparation did not complete (code $uwaMigrationStatus). Open Workspace Agent for details. Existing data and program backups are retained; a repair installer can be installed over this version." /SD IDOK
    ${If} ${Silent}
    ${AndIf} ${isForceRun}
      Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    ${EndIf}
    SetErrorLevel $uwaMigrationStatus
    Quit
  ${EndIf}
!macroend

; The version-scoped builder adapter calls this after extraction, BEFORE registry
; and shortcut commit. Only migrate a positively identified non-admin user.
; A receipt proving unchanged data allows .onInstFailed to restore old binaries
; with their original registration. Missing proof must never trigger rollback.
!macro agentPrepareUserData
  StrCpy $uwaMigrationStatus 0
  ClearErrors
  ${GetOptions} $CMDLINE "/DEFERDATAMIGRATION" $R1
  ${IfNot} ${Errors}
    !insertmacro agentInstallTrace "data-upgrade-deferred-explicit"
  ${Else}
    UserInfo::GetAccountType
    Pop $R0
    ${If} $R0 != "User"
      !insertmacro agentInstallTrace "data-upgrade-deferred-user-context"
    ${Else}
      !insertmacro agentRunDataUpgrade
    ${EndIf}
  ${EndIf}
!macroend

!macro agentRunDataUpgrade
    !insertmacro agentInstallTrace "data-upgrade-start"
    InitPluginsDir
    Delete "$PLUGINSDIR\data-upgrade-result"
    ClearErrors
    ${If} ${Silent}
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --migrate-data-only --migration-headless "--migration-result-file=$PLUGINSDIR\data-upgrade-result"' $R0
    ${Else}
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --migrate-data-only "--migration-result-file=$PLUGINSDIR\data-upgrade-result"' $R0
    ${EndIf}
    ${If} ${Errors}
      StrCpy $R0 20
    ${EndIf}
    StrCpy $uwaMigrationStatus $R0
    !insertmacro agentInstallTrace "data-upgrade-result-$R0"
    ${If} $R0 != 0
      StrCpy $R1 ""
      FileOpen $R8 "$PLUGINSDIR\data-upgrade-result" r
      FileRead $R8 $R1
      FileClose $R8
      ${If} $R1 == "unchanged"
        !insertmacro agentInstallTrace "data-upgrade-rollback-safe"
        MessageBox MB_OK|MB_ICONEXCLAMATION "Local data preparation failed (code $uwaMigrationStatus). Your previous data is unchanged. Installation will stop and restore the previous program when available. Resolve the reported data issue and run the installer again." /SD IDOK
        SetErrorLevel $uwaMigrationStatus
        Abort "Local data preparation failed; restoring the previous installation."
      ${EndIf}
      ; The child may have been killed during activation. Commit the extracted
      ; program, retain backups, and let startup recover its migration journal.
    ${EndIf}
!macroend

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ; A committed replacement may have failed its first data preparation. Keep
    ; its old binaries in a unique recovery directory so a fix can be installed.
    ; Uncommitted/foreign backups remain protected from automatic mutation.
    ${If} ${FileExists} "$INSTDIR.uwa-previous\*.*"
      InitPluginsDir
      File /oname=$PLUGINSDIR\preserve-install-backup.ps1 "${BUILD_RESOURCES_DIR}\preserve-install-backup.ps1"
      System::Call 'kernel32::SetEnvironmentVariable(t "UWA_INSTALL_DIRECTORY", t "$INSTDIR")'
      nsExec::ExecToLog /TIMEOUT=10000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\preserve-install-backup.ps1"'
      Pop $R0
      System::Call 'kernel32::SetEnvironmentVariable(t "UWA_INSTALL_DIRECTORY", t "")'
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR.uwa-previous\*.*"
      !insertmacro agentInstallTrace "backup-already-exists"
      MessageBox MB_OK|MB_ICONSTOP "Previous installation backup requires recovery before another update." /SD IDOK
      SetErrorLevel 1
      Quit
    ${EndIf}
  !endif
  !insertmacro agentInstallTrace "check-app-start"
  InitPluginsDir
  File /oname=$PLUGINSDIR\close-agent.ps1 "${BUILD_RESOURCES_DIR}\close-agent.ps1"
  System::Call 'kernel32::SetEnvironmentVariable(t "UWA_INSTALL_EXECUTABLE", t "$INSTDIR\${APP_EXECUTABLE_FILENAME}")'
  nsExec::ExecToLog /TIMEOUT=30000 '"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\close-agent.ps1"'
  Pop $R0
  !insertmacro agentInstallTrace "check-app-result-$R0"
  ${If} $R0 == 10
    ${IfNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +3
      SetErrorLevel 1
      Quit
    ${EndIf}
    ${Do}
      nsExec::ExecToLog /TIMEOUT=20000 '"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\close-agent.ps1" -Stop'
      Pop $R0
      ${If} $R0 == 0
        ${ExitDo}
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY +3
      SetErrorLevel 1
      Quit
    ${Loop}
  ${ElseIf} $R0 != 0
    MessageBox MB_OK|MB_ICONSTOP "$(appCannotBeClosed)" /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariable(t "UWA_INSTALL_EXECUTABLE", t "")'
  ; The parent installer also held $INSTDIR as its current directory. Moving
  ; only the child's working directory is insufficient on Windows.
  SetOutPath $TEMP
  !insertmacro agentInstallTrace "check-app-complete"
!macroend
