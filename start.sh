#!/usr/bin/env sh
# ClassControl — пробный запуск на macOS и Linux: ./start.sh
# Нужен Node.js 20+. Всё остальное поставится само при первом запуске.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Нужен Node.js 20 или новее."
  if [ "$(uname)" = "Darwin" ]; then
    echo "Скачайте установщик LTS: https://nodejs.org  (или: brew install node)"
  else
    echo "Установите: https://nodejs.org/en/download  (или через менеджер пакетов, например: sudo apt install nodejs npm)"
  fi
  exit 1
fi
exec node scripts/demo.js "$@"
