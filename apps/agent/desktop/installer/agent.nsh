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
!macro customRemoveFiles
  SetOutPath $TEMP
  ${If} ${isUpdated}
    !insertmacro agentInstallTrace "rename-old-start"
    ${If} ${FileExists} "$INSTDIR.uwa-previous\*.*"
      !insertmacro agentInstallTrace "backup-already-exists"
      Abort "Previous installation backup requires recovery before another update."
    ${EndIf}
    ClearErrors
    Rename "$INSTDIR" "$INSTDIR.uwa-previous"
    ${If} ${Errors}
      !insertmacro agentInstallTrace "rename-old-failed"
      Abort "Cannot move the old installation; its files were left in place."
    ${EndIf}
    !insertmacro agentInstallTrace "rename-old-complete"
    FileOpen $R8 "$INSTDIR.uwa-previous\.uwa-backup-owner" w
    FileWriteUTF16LE /BOM $R8 "$INSTDIR"
    FileClose $R8
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

; Builder includes this file before LogicLib. Expand the callback only at the
; supported header hook, after the standard NSIS libraries have been loaded.
!macro customHeader
!ifndef BUILD_UNINSTALLER
Function .onInstFailed
  ${If} ${FileExists} "$INSTDIR.uwa-previous\.uwa-backup-owner"
    !insertmacro agentInstallTrace "restore-old-start"
    SetOutPath $TEMP
    ${If} ${FileExists} "$INSTDIR\*.*"
      ${If} ${FileExists} "$INSTDIR.uwa-failed\*.*"
        !insertmacro agentInstallTrace "restore-blocked-by-previous-failure"
        Return
      ${EndIf}
      ClearErrors
      Rename "$INSTDIR" "$INSTDIR.uwa-failed"
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

!macro customInstall
  !insertmacro agentInstallTrace "install-files-complete"
!macroend

!macro customCheckAppRunning
  !insertmacro agentInstallTrace "check-app-start"
  InitPluginsDir
  File /oname=$PLUGINSDIR\close-agent.ps1 "${BUILD_RESOURCES_DIR}\close-agent.ps1"
  System::Call 'kernel32::SetEnvironmentVariable(t "UWA_INSTALL_EXECUTABLE", t "$INSTDIR\${APP_EXECUTABLE_FILENAME}")'
  nsExec::ExecToLog /TIMEOUT=15000 '"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\close-agent.ps1"'
  Pop $R0
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
