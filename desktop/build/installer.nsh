!macro customInstall
  ${If} ${FileExists} "$newDesktopLink"
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\viniper-ui\scripts\set_shortcut_app_id.ps1" -ShortcutPath "$newDesktopLink" -AppUserModelId "${APP_ID}"' $0
    ${If} $0 != 0
      Abort "Viniper desktop shortcut identity could not be written."
    ${EndIf}
  ${EndIf}

  ${If} ${FileExists} "$newStartMenuLink"
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\viniper-ui\scripts\set_shortcut_app_id.ps1" -ShortcutPath "$newStartMenuLink" -AppUserModelId "${APP_ID}"' $0
    ${If} $0 != 0
      Abort "Viniper Start menu shortcut identity could not be written."
    ${EndIf}
  ${EndIf}
!macroend
