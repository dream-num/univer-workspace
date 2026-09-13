; Override builder's directory-prefix process matching, which can include the
; uninstaller itself. Keep consent/retry behavior, and scope kills to this app.
!macro customCheckAppRunning
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
!macroend
