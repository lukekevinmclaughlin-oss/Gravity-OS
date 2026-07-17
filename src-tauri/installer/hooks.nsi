; Gravity OS — NSIS installer hooks
; Wired into Tauri's NSIS template via bundle.windows.nsis.installerHooks.
;
; Install:   register login autostart (overlay mode) so Gravity launches at
;            sign-in. Full shell replacement is opt-in from inside Gravity,
;            never forced by the installer.
; Uninstall: remove autostart AND restore the default Windows shell, so the
;            machine always boots back into Explorer after removal.

!macro NSIS_HOOK_POSTINSTALL
  ; Launch Gravity OS at login (per-user).
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GravityOS" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Stop autostart.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GravityOS"

  ; Restore the default Windows shell. The per-user Winlogon "Shell" override
  ; is non-standard and only set when Gravity's full-replacement mode is on;
  ; removing it hands the desktop back to Explorer at next sign-in.
  DeleteRegValue HKCU "Software\Microsoft\Windows NT\CurrentVersion\Winlogon" "Shell"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
