Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
!define APP_EXECUTABLE_FILENAME "Univer Workspace Agent.exe"
!define isUpdated '1 = 1'
!include "${AGENT_INCLUDE}"
Name "Agent directory replacement fixture"
OutFile "${FIXTURE_EXE}"
RequestExecutionLevel user
SilentInstall silent
Var PowerShellPath
LangString appRunning 1033 "Running"
LangString appCannotBeClosed 1033 "Cannot close"
Section
  WriteUninstaller "$EXEDIR\fixture-uninstall.exe"
  ; Reproduce builder's initial working directory before the app-close hook.
  SetOutPath $INSTDIR
  StrCpy $PowerShellPath "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  !insertmacro customCheckAppRunning
  ExecWait '"$EXEDIR\fixture-uninstall.exe" /S _?=$INSTDIR' $R0
  IntCmp $R0 0 +2
    Abort "Uninstaller failed"
  IfFileExists "$INSTDIR.fail" 0 +2
    Abort "Injected extraction failure"
  CreateDirectory "$INSTDIR"
  FileOpen $R0 "$INSTDIR\new.txt" w
  FileWrite $R0 "new"
  FileClose $R0
SectionEnd
Section "Uninstall"
  !insertmacro customRemoveFiles
SectionEnd
