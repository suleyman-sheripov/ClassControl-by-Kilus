; ClassControl Agent — дополнения установщика

; Сторож: задание планировщика Windows для всех пользователей компьютера.
; При входе в систему и затем раз в минуту запускает агент с --watchdog.
; Если агент уже работает, повторный запуск ничего не делает; если ученик его
; закрыл через Диспетчер задач — через минуту он снова на связи с учителем.
!macro writeWatchdogTask
  FileOpen $0 "$PLUGINSDIR\classcontrol-task.xml" w
  FileWriteWord $0 0xFEFF
  FileWriteUTF16LE $0 '<?xml version="1.0" encoding="UTF-16"?>$\r$\n'
  FileWriteUTF16LE $0 '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">$\r$\n'
  FileWriteUTF16LE $0 '<RegistrationInfo><Description>ClassControl Agent: держит агент запущенным во время уроков</Description></RegistrationInfo>$\r$\n'
  FileWriteUTF16LE $0 '<Triggers><LogonTrigger><Enabled>true</Enabled><Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></LogonTrigger></Triggers>$\r$\n'
  FileWriteUTF16LE $0 '<Principals><Principal id="Author"><GroupId>S-1-5-32-545</GroupId><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>$\r$\n'
  FileWriteUTF16LE $0 '<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Hidden>true</Hidden><StartWhenAvailable>true</StartWhenAvailable></Settings>$\r$\n'
  FileWriteUTF16LE $0 '<Actions Context="Author"><Exec><Command>"$INSTDIR\${APP_EXECUTABLE_FILENAME}"</Command><Arguments>--watchdog</Arguments></Exec></Actions>$\r$\n'
  FileWriteUTF16LE $0 '</Task>$\r$\n'
  FileClose $0
  nsExec::Exec 'schtasks /Create /F /TN "ClassControl Agent" /XML "$PLUGINSDIR\classcontrol-task.xml"'
  Pop $0
!macroend

!macro customInstall
  ; Ярлык «Настройки агента» в меню Пуск (открывает настройки под паролем администратора)
  CreateDirectory "$SMPROGRAMS\ClassControl"
  CreateShortCut "$SMPROGRAMS\ClassControl\Настройки агента.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--config"
  !insertmacro writeWatchdogTask
!macroend

!macro customUnInstall
  nsExec::Exec 'schtasks /Delete /F /TN "ClassControl Agent"'
  Pop $0
  Delete "$SMPROGRAMS\ClassControl\Настройки агента.lnk"
!macroend
