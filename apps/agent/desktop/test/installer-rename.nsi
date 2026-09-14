Unicode true
!define APP_EXECUTABLE_FILENAME "Univer Workspace Agent.exe"
!define isUpdated '1 = 1'
!include "${AGENT_INCLUDE}"
!include LogicLib.nsh
!include FileFunc.nsh
!insertmacro customHeader
!addplugindir "${NSIS_PLUGINS}"
!define ZIP_COMPRESSION
!include "${TRACED_EXTRACTION_INCLUDE}"
Var packageArch
Name "Agent directory replacement fixture"
OutFile "${FIXTURE_EXE}"
RequestExecutionLevel user
SilentInstall silent
Var PowerShellPath
LangString appRunning 1033 "Running"
LangString appCannotBeClosed 1033 "Cannot close"
LangString decompressionFailed 1033 "Cannot extract"
Section
  WriteUninstaller "$EXEDIR\fixture-uninstall.exe"
  ; Reproduce builder's initial working directory before the app-close hook.
  SetOutPath $INSTDIR
  StrCpy $PowerShellPath "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  !insertmacro customCheckAppRunning
  ExecWait '"$EXEDIR\fixture-uninstall.exe" /S _?=$INSTDIR' $R0
  IntCmp $R0 0 +2
    Abort "Uninstaller failed"
  ${If} ${FileExists} "$INSTDIR.fail"
    ; Exercise the actual generated builder ZIP failure path with corrupt input.
    InitPluginsDir
    StrCpy $packageArch "fixture"
    FileOpen $R0 "$PLUGINSDIR\app-fixture.zip" w
    FileWrite $R0 "not a zip archive"
    FileClose $R0
    !insertmacro decompress
  ${EndIf}
  CreateDirectory "$INSTDIR"
  FileOpen $R0 "$INSTDIR\new.txt" w
  FileWrite $R0 "new"
  FileClose $R0
SectionEnd
Section "Uninstall"
  !insertmacro customRemoveFiles
SectionEnd
