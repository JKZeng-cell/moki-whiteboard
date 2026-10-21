!include "${__FILEDIR__}\installer-files.nsh"

!macro customInstall
  ; Offer Open With without replacing the workbench or user's default association.
  WriteRegStr HKCU "Software\Classes\MOKI.Whiteboard.File" "" "MOKI 白板文件"
  WriteRegStr HKCU "Software\Classes\MOKI.Whiteboard.File\Application" "ApplicationName" "MOKI 白板"
  WriteRegStr HKCU "Software\Classes\MOKI.Whiteboard.File\DefaultIcon" "" '"$INSTDIR\MOKI Whiteboard.exe",0'
  WriteRegStr HKCU "Software\Classes\MOKI.Whiteboard.File\shell\open\command" "" '"$INSTDIR\MOKI Whiteboard.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\.moki\OpenWithProgids" "MOKI.Whiteboard.File" ""
  WriteRegStr HKCU "Software\Classes\.moki-board\OpenWithProgids" "MOKI.Whiteboard.File" ""
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Classes\.moki\OpenWithProgids" "MOKI.Whiteboard.File"
  DeleteRegValue HKCU "Software\Classes\.moki-board\OpenWithProgids" "MOKI.Whiteboard.File"
  DeleteRegKey HKCU "Software\Classes\MOKI.Whiteboard.File"
!macroend

!macro customRemoveFiles
  SetOutPath "$TEMP"
  !insertmacro MokiRemoveProgramFiles
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  ; Non-recursive: any material directory (including whiteboard-materials) stays untouched.
  RMDir "$INSTDIR"
!macroend
