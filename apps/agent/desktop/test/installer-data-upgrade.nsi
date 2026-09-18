Unicode true
!define APP_EXECUTABLE_FILENAME "MigrationFixture.exe"
!define isForceRun '$R4 == "force"'
!define isUpdated '1 = 1'
!include "${AGENT_INCLUDE}"
!include LogicLib.nsh
!include FileFunc.nsh
!insertmacro customHeader
Name "Agent data upgrade fixture"
OutFile "${FIXTURE_EXE}"
RequestExecutionLevel user
SilentInstall silent
Var PowerShellPath
LangString appRunning 1033 "Running"
LangString appCannotBeClosed 1033 "Cannot close"
Section
  StrCpy $PowerShellPath "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  !insertmacro customCheckAppRunning
  !insertmacro agentRenameInstallation
  CreateDirectory "$INSTDIR"
  CopyFiles /SILENT "$EXEDIR\payload\*.*" "$INSTDIR"
  ClearErrors
  ${GetOptions} $CMDLINE "/FORCERUN" $R4
  ${If} ${Errors}
    StrCpy $R4 "none"
  ${Else}
    StrCpy $R4 "force"
  ${EndIf}
  ; Test the execution macro even on admin CI; separately exercise deferral.
  ClearErrors
  ${GetOptions} $CMDLINE "/DEFERDATAMIGRATION" $R1
  ${IfNot} ${Errors}
    !insertmacro agentPrepareUserData
  ${Else}
    !insertmacro agentRunDataUpgrade
  ${EndIf}
  ; Stand in for builder registration, which must follow data preparation.
  FileOpen $R8 "$INSTDIR.registration" w
  FileWrite $R8 "new"
  FileClose $R8
  !insertmacro customInstall
SectionEnd
