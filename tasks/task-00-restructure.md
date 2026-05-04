# Задача 0: Реструктуризация проекта

> **Контекст:** Читай `TZ.md` в корне проекта для понимания общей архитектуры.
> **Обзорный план:** `.agent/workflows/classcontrol-implementation.md`

## Цель
Переорганизовать текущую структуру проекта из плоской (`public/`, `agent/`, `server.js`) в модульную с чётким разделением компонентов.

## Текущая структура (что есть сейчас)
```
DEMO-DIPLOM/
├── public/          # HTML/CSS/JS для веб-интерфейса (учитель + ученик в одном)
│   ├── index.html
│   ├── style.css
│   └── script.js
├── agent/           # Electron-агент ученика
│   ├── main.js
│   ├── preload.js
│   ├── renderer.js
│   └── package.json
├── server.js        # Сервер Express + Socket.IO
└── package.json
```

## Целевая структура (что должно быть)
```
DEMO-DIPLOM/
├── server/
│   ├── server.js        # Копия текущего server.js (будет модифицирован в task-01)
│   ├── uploads/         # Пустая папка для загруженных файлов чата
│   └── package.json
├── teacher/
│   ├── main.js          # Пустой файл (будет написан в task-02)
│   ├── preload.js       # Пустой файл (будет написан в task-02)
│   ├── renderer/
│   │   ├── index.html   # Пустой файл (будет написан в task-03)
│   │   ├── style.css    # Пустой файл (будет написан в task-03)
│   │   └── script.js    # Пустой файл (будет написан в task-04)
│   ├── assets/          # Пустая папка для иконок
│   └── package.json
├── agent/               # УЖЕ СУЩЕСТВУЕТ — НЕ ТРОГАЙ содержимое
│   └── (оставь как есть)
├── online/
│   ├── index.html       # Скопируй из public/index.html
│   ├── style.css        # Скопируй из public/style.css
│   └── script.js        # Скопируй из public/script.js
├── tasks/               # Папка с задачами (уже создана)
├── TZ.md
└── README.md
```

## Пошаговые действия

### Шаг 1: Создать папку `server/`
```bash
mkdir server
mkdir server\uploads
```

### Шаг 2: Перенести `server.js`
```bash
copy server.js server\server.js
```

### Шаг 3: Создать `server/package.json`
Создай файл `server/package.json` с содержимым:
```json
{
  "name": "classcontrol-server",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "socket.io": "^4.7.0",
    "multer": "^1.4.5-lts.1"
  }
}
```

### Шаг 4: Создать папку `teacher/` со структурой
```bash
mkdir teacher
mkdir teacher\renderer
mkdir teacher\assets
```
Создай пустые файлы-заглушки (просто чтобы структура была):
- `teacher/main.js` → содержимое: `// TODO: task-02`
- `teacher/preload.js` → содержимое: `// TODO: task-02`
- `teacher/renderer/index.html` → содержимое: `<!-- TODO: task-03 -->`
- `teacher/renderer/style.css` → содержимое: `/* TODO: task-03 */`
- `teacher/renderer/script.js` → содержимое: `// TODO: task-04`

### Шаг 5: Создать `teacher/package.json`
```json
{
  "name": "classcontrol-teacher",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder --win"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0"
  },
  "dependencies": {
    "socket.io-client": "^4.7.0"
  }
}
```

### Шаг 6: Создать папку `online/`
```bash
mkdir online
copy public\index.html online\index.html
copy public\style.css online\style.css
copy public\script.js online\script.js
```

### Шаг 7: Установить зависимости
```bash
cd server && npm install
cd ..\teacher && npm install
```
Агент (`agent/`) уже имеет свои зависимости — не трогай.

## ⚠️ ВАЖНО
- **НЕ удаляй** `public/` пока — она может понадобиться как референс.
- **НЕ трогай** `agent/` — его модификация будет в task-06.
- **НЕ трогай** корневой `server.js` — он может использоваться для тестов.

## ✅ Проверка завершения
- [ ] Папка `server/` существует, содержит `server.js`, `package.json`, `uploads/`.
- [ ] Папка `teacher/` существует со всеми подпапками и файлами-заглушками.
- [ ] Папка `online/` содержит скопированные файлы из `public/`.
- [ ] `cd server && npm install` — без ошибок.
- [ ] `cd teacher && npm install` — без ошибок.
