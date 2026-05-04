# Задача 6: Ученик-Агент — Ядро (main.js, трей, автозапуск, LAN Discovery)

> **Контекст:** Читай `TZ.md` (разделы 5, 7.8, 8). Текущий агент — в `agent/`.
> **Рабочие файлы:** `agent/main.js`, `agent/preload.js`

## Цель
Переписать main.js агента: работа в трее без возможности закрытия, автозапуск с Windows, автоматическое обнаружение сервера по UDP, три окна (скрытое фоновое, чат, демонстрация).

## Файл: `agent/main.js` — полная перезапись

### 1. Импорты
```javascript
const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const dgram = require('dgram');
```

### 2. Переменные
```javascript
let tray = null;
let hiddenWindow = null;  // Фоновое окно (скриншоты, WebRTC)
let chatWindow = null;    // Окно чата
let demoWindow = null;    // Окно демонстрации (fullscreen)
let serverAddress = null; // 'http://IP:PORT'
```

### 3. Автозапуск с Windows
```javascript
app.setLoginItemSettings({
  openAtLogin: true,
  path: app.getPath('exe'),
  args: ['--hidden']
});
```

### 4. Создание трея
```javascript
function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'icon.png'));
  tray.setToolTip('ClassControl Agent');

  // ТОЛЬКО пункт "Открыть чат" — ПУНКТА "ВЫХОД" НЕТ!
  const contextMenu = Menu.buildFromTemplate([
    { label: '💬 Открыть чат', click: () => openChatWindow() }
  ]);
  tray.setContextMenu(contextMenu);
}
```

### 5. Скрытое фоновое окно
```javascript
function createHiddenWindow() {
  hiddenWindow = new BrowserWindow({
    show: false,           // СКРЫТОЕ!
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  hiddenWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
```

### 6. Окно чата
```javascript
function openChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
    return;
  }
  chatWindow = new BrowserWindow({
    width: 400,
    height: 600,
    title: 'ClassControl — Чат',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  chatWindow.setMenuBarVisibility(false);
  chatWindow.loadFile(path.join(__dirname, 'renderer', 'chat.html'));
}
```

### 7. Окно демонстрации (fullscreen)
```javascript
function openDemoWindow() {
  if (demoWindow && !demoWindow.isDestroyed()) return;
  demoWindow = new BrowserWindow({
    fullscreen: true,
    alwaysOnTop: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  demoWindow.loadFile(path.join(__dirname, 'renderer', 'demo.html'));
}

function closeDemoWindow() {
  if (demoWindow && !demoWindow.isDestroyed()) {
    demoWindow.close();
    demoWindow = null;
  }
}
```

### 8. IPC (между main и renderer)
```javascript
ipcMain.on('server-found', (event, address) => {
  serverAddress = address;
  console.log('[AGENT] Сервер найден:', address);
});

ipcMain.on('open-demo', () => openDemoWindow());
ipcMain.on('close-demo', () => closeDemoWindow());
ipcMain.on('open-chat', () => openChatWindow());

// Для скриншотов
ipcMain.handle('take-screenshot', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 180 }
  });
  return sources[0]?.thumbnail.toJPEG(30).toString('base64');
});
```

### 9. Жизненный цикл
```javascript
app.whenReady().then(() => {
  createTray();
  createHiddenWindow();
});

// НЕ закрывать приложение при закрытии всех окон!
app.on('window-all-closed', (e) => {
  e.preventDefault(); // Остаёмся в трее
});
```

### 10. LAN Discovery (встроен в main.js)
```javascript
function discoverServer() {
  const client = dgram.createSocket('udp4');
  client.setBroadcast(true);
  const msg = Buffer.from('CLASSCONTROL_DISCOVER');

  const tryDiscover = () => {
    client.send(msg, 0, msg.length, 41234, '255.255.255.255', (err) => {
      if (err) console.error('[AGENT] UDP send error:', err);
    });
  };

  client.on('message', (data) => {
    const response = data.toString();
    if (response.startsWith('CLASSCONTROL_SERVER:')) {
      const parts = response.split(':');
      serverAddress = `http://${parts[1]}:${parts[2]}`;
      console.log('[AGENT] Сервер обнаружен:', serverAddress);
      // Сообщить скрытому окну
      if (hiddenWindow) hiddenWindow.webContents.send('server-address', serverAddress);
      if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.send('server-address', serverAddress);
      client.close();
    }
  });

  // Попытка каждые 3 секунды, пока не найдём
  tryDiscover();
  const interval = setInterval(() => {
    if (serverAddress) { clearInterval(interval); return; }
    tryDiscover();
  }, 3000);
}

app.whenReady().then(() => {
  createTray();
  createHiddenWindow();
  setTimeout(discoverServer, 1000); // Начать поиск через 1 сек
});
```

## Файл: `agent/preload.js`

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  onServerAddress: (callback) => ipcRenderer.on('server-address', (e, addr) => callback(addr)),
  openDemo: () => ipcRenderer.send('open-demo'),
  closeDemo: () => ipcRenderer.send('close-demo'),
  openChat: () => ipcRenderer.send('open-chat'),
  platform: process.platform
});
```

## ✅ Проверка завершения
```bash
cd agent && cmd /c npm start
```
- [ ] Окно НЕ появляется при запуске.
- [ ] Иконка видна в системном трее.
- [ ] Правый клик по трею → меню только с «💬 Открыть чат» (нет пункта «Выход»).
- [ ] Клик «Открыть чат» → открывается окно чата 400×600.
- [ ] В консоли видно: «[AGENT] Сервер обнаружен: http://...» (если сервер запущен).
