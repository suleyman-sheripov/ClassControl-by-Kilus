# Задача 10: Сборка и установка (electron-builder)

> **Контекст:** Читай `TZ.md` (разделы 8, 11). Все компоненты готовы.
> **Рабочие файлы:** `teacher/package.json`, `agent/package.json`

## Цель
Настроить `electron-builder` для сборки `.exe` установщиков обоих приложений. Соблюсти требования: у агента нет ярлыка на рабочем столе, есть автозапуск.

## Файл: `teacher/package.json` — обновить секцию `build`

Добавь в существующий `package.json` поле `"build"`:

```json
{
  "name": "classcontrol-teacher",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder --win"
  },
  "build": {
    "appId": "com.classcontrol.teacher",
    "productName": "ClassControl Teacher",
    "directories": {
      "output": "../dist/teacher"
    },
    "files": [
      "**/*",
      "../server/**/*"
    ],
    "extraResources": [
      {
        "from": "../server",
        "to": "server",
        "filter": ["**/*", "!node_modules/**/*"]
      }
    ],
    "win": {
      "target": "nsis",
      "icon": "assets/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "ClassControl Teacher"
    }
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0"
  },
  "dependencies": {
    "express": "^4.18.0",
    "socket.io": "^4.7.0",
    "multer": "^1.4.5-lts.1",
    "socket.io-client": "^4.7.0"
  }
}
```

**Примечание:** Серверные зависимости (`express`, `socket.io`, `multer`) включены в teacher, т.к. сервер запускается внутри Electron.

## Файл: `agent/package.json` — обновить секцию `build`

```json
{
  "name": "classcontrol-agent",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder --win"
  },
  "build": {
    "appId": "com.classcontrol.agent",
    "productName": "ClassControl Agent",
    "directories": {
      "output": "../dist/agent"
    },
    "win": {
      "target": "nsis",
      "icon": "assets/icon.ico"
    },
    "nsis": {
      "oneClick": true,
      "createDesktopShortcut": false,
      "createStartMenuShortcut": true,
      "menuCategory": "ClassControl",
      "shortcutName": "ClassControl Configurator"
    }
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0"
  },
  "dependencies": {
    "@computer-use/nut-js": "^4.2.0",
    "socket.io-client": "^4.7.0"
  }
}
```

**Ключевые отличия для агента:**
- `"createDesktopShortcut": false` — **НЕТ** ярлыка на рабочем столе.
- `"createStartMenuShortcut": true` — Только в Пуск.
- `"menuCategory": "ClassControl"` — В подпапке «ClassControl» в Пуске.
- `"shortcutName": "ClassControl Configurator"` — Как в Veyon.

## Иконки

Перед сборкой нужны иконки в формате `.ico`:
- `teacher/assets/icon.ico` — Иконка учителя (256×256).
- `agent/assets/icon.ico` — Иконка агента (256×256).

Если иконок нет — создай простые PNG 256×256 и конвертируй в ICO (онлайн-конвертер или npm-пакет `png-to-ico`). Или пока используй заглушку.

## Сборка

```bash
# Сборка учителя
cd teacher
cmd /c npx electron-builder --win

# Сборка агента
cd ..\agent
cmd /c npx electron-builder --win
```

Результаты будут в:
- `dist/teacher/ClassControl Teacher Setup *.exe`
- `dist/agent/ClassControl Agent Setup *.exe`

## ✅ Проверка завершения

**Учитель:**
- [ ] `.exe` установщик собран без ошибок.
- [ ] При установке создаётся ярлык на рабочем столе + в Пуске.
- [ ] Приложение запускается из установленного ярлыка.

**Агент:**
- [ ] `.exe` установщик собран без ошибок.
- [ ] При установке ярлык создаётся ТОЛЬКО в Пуске (в Category «ClassControl»).
- [ ] На рабочем столе ярлыка НЕТ.
- [ ] Приложение запускается из Пуска как «ClassControl Configurator».
- [ ] После перезагрузки ПК агент автоматически запускается и появляется в трее.
