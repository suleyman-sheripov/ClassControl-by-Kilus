; Ярлык «Настройки агента» в меню Пуск (открывает настройки под паролем администратора)
!macro customInstall
  CreateDirectory "$SMPROGRAMS\ClassControl"
  CreateShortCut "$SMPROGRAMS\ClassControl\Настройки агента.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--config"
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\ClassControl\Настройки агента.lnk"
!macroend
