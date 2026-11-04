@echo off
chcp 65001 >nul
rem ClassControl - пробный запуск на Windows: двойной щелчок по этому файлу
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Нужен Node.js 20 или новее.
  where winget >nul 2>nul
  if not errorlevel 1 (
    echo Ставлю Node.js LTS через winget...
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    echo Готово. Закройте это окно и запустите start.cmd ещё раз.
  ) else (
    echo Скачайте установщик LTS: https://nodejs.org
  )
  pause
  exit /b 1
)
node scripts\demo.js %*
if errorlevel 1 pause
