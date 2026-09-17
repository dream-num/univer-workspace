Unicode true
!define APP_EXECUTABLE_FILENAME "MigrationFixture.exe"
!define isForceRun '$R4 == "force"'
!include "${AGENT_INCLUDE}"
!include LogicLib.nsh
!include FileFunc.nsh
!insertmacro customHeader
Name "Agent data upgrade fixture"
OutFile "${FIXTURE_EXE}"
RequestExecutionLevel user
SilentInstall silent
Section
  ClearErrors
  ${GetOptions} $CMDLINE "/FORCERUN" $R4
  ${If} ${Errors}
    StrCpy $R4 "none"
  ${Else}
    StrCpy $R4 "force"
  ${EndIf}
  ; /DEFERDATAMIGRATION exercises the full context gate. The other cases call
  ; the same execution macro directly so admin CI can test exit handling too.
  ClearErrors
  ${GetOptions} $CMDLINE "/DEFERDATAMIGRATION" $R1
  ${IfNot} ${Errors}
    !insertmacro agentPrepareUserData
  ${Else}
    !insertmacro agentRunDataUpgrade
  ${EndIf}
SectionEnd
