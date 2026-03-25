!macro preInit
  ; Se o INSTDIR já foi definido (pelo /D no CLI), não sobrescrevemos
  StrCmp $INSTDIR "" 0 done_default
    
  ReadRegStr $0 HKLM "Software\TanamaoHub" "InstallPath"
  StrCmp $0 "" use_default
    StrCpy $INSTDIR "$0"
    Goto done_default

  use_default:
    StrCpy $INSTDIR "C:\Sunny\Tanamao\Tanamao Hub"

  done_default:
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
!macroend
