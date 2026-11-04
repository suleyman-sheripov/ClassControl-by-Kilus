# Задача 2: Electron-оболочка учителя (Master)

> **Контекст:** Читай `TZ.md` (разделы 2.1, 4). Сервер готов (task-01).
> **Рабочие файлы:** `teacher/main.js`, `teacher/preload.js`

## Цель
Создать Electron main process для приложения учителя. При запуске оно автоматически поднимает сервер и открывает главное окно.

## Файл: `teacher/main.js`

Создай файл с нуля. Он должен делать следующее:

**1. Импорты:**
```javascript
const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
```

**2. Запуск встроенного сервера:**
При готовности приложения (`app.whenReady()`) — подключить серверный модуль:
```javascript
// Запускаем сервер прямо внутри Electron
require('../server/server.js');
```
Убедись, что `server.js` экспортирует работающий сервер или просто запускается при `require()`. Если текущий `server.js` не экспортирует ничего, а просто вызывает `app.listen()` — это подходит, `require()` его запустит.

**3. Создание главного окна:**
```javascript
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'ClassControl — Учитель',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Убрать стандартное меню Electron
  mainWindow.setMenuBarVisibility(false);
}
```

**4. Жизненный цикл:**
```javascript
app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
```

**5. IPC для desktopCapturer (запись экрана — понадобится в task-09):**
```javascript
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 }
  });
  return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
});
```

## Файл: `teacher/preload.js`

Создай файл. Preload даёт renderer-процессу безопасный доступ к Node.js API:

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  onNavigate: (callback) => ipcRenderer.on('navigate', callback),
  platform: process.platform
});
```

## ✅ Проверка завершения
```bash
cd teacher && cmd /c npm start
```
- [ ] Electron-окно открывается (пусть пустое — renderer ещё не написан).
- [ ] В консоли Electron видно `[SERVER] Listening on port 3000` (сервер запущен).
- [ ] Окно имеет тёмный фон (`#0f1117`).
- [ ] Размер окна 1400×900, нельзя уменьшить меньше 1200×700.
- [ ] Стандартное меню Electron скрыто.
