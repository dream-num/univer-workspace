; Override builder's directory-prefix process matching, which can include the
; uninstaller itself. Keep consent/retry behavior, and scope kills to this app.
!macro agentInstallTrace PHASE
  Push $R7
  Push $R8
  Push $R9
  ReadEnvStr $R7 UWA_INSTALL_TRACE
  ${If} $R7 != ""
    System::Call 'kernel32::GetTickCount() i.R9'
    FileOpen $R8 "$R7" a
    FileWrite $R8 "${PHASE}:$R9$\r$\n"
    FileClose $R8
  ${EndIf}
  Pop $R9
  Pop $R8
  Pop $R7
!macroend

!macro customUnInstall
  !insertmacro agentInstallTrace "uninstall-files-start"
!macroend

; Updating used to move every file through electron-builder's rollback walker.
; The old uninstaller is already copied out of $INSTDIR, so the directory can
; be moved as one unit. The installer then creates the original path and
; extracts the new payload. Keep the old tree until this uninstaller exits;
; Windows updates are full payloads and do not need per-file replacement.
!macro customRemoveFiles
  !insertmacro agentInstallTrace "rename-old-start"
  CreateDirectory "$PLUGINSDIR\old-install-parent"
  ClearErrors
  Rename "$INSTDIR" "$PLUGINSDIR\old-install-parent\old-install"
  IfErrors 0 +3
    !insertmacro agentInstallTrace "rename-old-failed"
    Abort
  !insertmacro agentInstallTrace "rename-old-complete"
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
  !insertmacro agentInstallTrace "check-app-complete"
!macroend
