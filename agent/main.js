const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');

let tray = null;
let hiddenWindow = null;  // Фоновое окно (скриншоты, WebRTC)
let chatWindow = null;    // Окно чата
let demoWindow = null;    // Окно демонстрации (fullscreen)
let serverAddress = null; // 'http://IP:PORT'

// --- Настройки агента (с сохранением в файл) ---
const SETTINGS_PATH = path.join(app.getPath('userData'), 'agent-settings.json');

const DEFAULT_SETTINGS = {
  showExitButton: false,      // Скрыта по умолчанию (чтобы ученики не вырубали)
  autoStartWithOS: true,      // Автозапуск с Windows
  showNotifications: true,    // Показывать уведомления в трее
  screenshotInterval: 1000,   // Интервал скриншотов (мс)
  networkMode: 'auto'         // 'auto' = LAN Discovery, 'localhost' = только localhost
};

let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      settings = { ...DEFAULT_SETTINGS, ...data };
    }
  } catch (err) {
    console.error('[AGENT] Ошибка загрузки настроек:', err.message);
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('[AGENT] Ошибка сохранения настроек:', err.message);
  }
}

function applyAutoStart() {
  app.setLoginItemSettings({
    openAtLogin: settings.autoStartWithOS,
    path: app.getPath('exe'),
    args: ['--hidden']
  });
}

// --- Трей и контекстное меню ---

function buildTrayMenu() {
  const menuItems = [
    { label: 'Открыть беседу', click: () => openChatWindow() },
    { type: 'separator' },
    {
      label: 'Настройки',
      submenu: [
        {
          label: 'Режим сети: LAN Discovery',
          type: 'radio',
          checked: settings.networkMode !== 'localhost',
          click: () => {
            settings.networkMode = 'auto';
            saveSettings();
            rebuildTrayMenu();
          }
        },
        {
          label: 'Режим сети: Только localhost',
          type: 'radio',
          checked: settings.networkMode === 'localhost',
          click: () => {
            settings.networkMode = 'localhost';
            saveSettings();
            rebuildTrayMenu();
          }
        },
        { type: 'separator' },
        {
          label: 'Показывать кнопку "Выход"',
          type: 'checkbox',
          checked: settings.showExitButton,
          click: (menuItem) => {
            settings.showExitButton = menuItem.checked;
            saveSettings();
            rebuildTrayMenu();
          }
        },
        {
          label: 'Автозапуск с Windows',
          type: 'checkbox',
          checked: settings.autoStartWithOS,
          click: (menuItem) => {
            settings.autoStartWithOS = menuItem.checked;
            saveSettings();
            applyAutoStart();
          }
        },
        {
          label: 'Показывать уведомления',
          type: 'checkbox',
          checked: settings.showNotifications,
          click: (menuItem) => {
            settings.showNotifications = menuItem.checked;
            saveSettings();
          }
        }
      ]
    }
  ];

  if (settings.showExitButton) {
    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: 'Выход',
      click: () => { app.isQuitting = true; app.quit(); }
    });
  }

  return Menu.buildFromTemplate(menuItems);
}

function rebuildTrayMenu() {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildTrayMenu());
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  try {
    tray = new Tray(iconPath);
  } catch (err) {
    console.error('[AGENT] Ошибка создания трея (icon.png не найден?):', err.message);
    return;
  }
  tray.setToolTip('ClassControl Agent');
  tray.setContextMenu(buildTrayMenu());
}

function createHiddenWindow() {
  hiddenWindow = new BrowserWindow({
    show: false,           // СКРЫТОЕ!
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  hiddenWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  // Отладка
  hiddenWindow.webContents.on('console-message', (event, level, message) => {
    console.log('[HIDDEN LOG]', message);
  });

  hiddenWindow.webContents.on('did-finish-load', () => {
    if (serverAddress) {
      hiddenWindow.webContents.send('server-address', serverAddress);
    }
  });
}

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
      nodeIntegration: false,
      sandbox: false
    }
  });
  chatWindow.setMenuBarVisibility(false);
  chatWindow.loadFile(path.join(__dirname, 'renderer', 'chat.html'));
  
  chatWindow.webContents.on('console-message', (event, level, message) => {
    console.log('[CHAT LOG]', message);
  });
  
  // Передать адрес сервера если он уже найден
  chatWindow.webContents.on('did-finish-load', () => {
    if (serverAddress) {
      chatWindow.webContents.send('server-address', serverAddress);
    }
  });
}

function openDemoWindow() {
  if (demoWindow && !demoWindow.isDestroyed()) return;
  demoWindow = new BrowserWindow({
    fullscreen: true,
    alwaysOnTop: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  demoWindow.loadFile(path.join(__dirname, 'renderer', 'demo.html'));
  // Передать адрес сервера после загрузки
  demoWindow.webContents.on('did-finish-load', () => {
    if (serverAddress) {
      demoWindow.webContents.send('server-address', serverAddress);
    }
  });
}

function closeDemoWindow() {
  if (demoWindow && !demoWindow.isDestroyed()) {
    demoWindow.close();
    demoWindow = null;
  }
}

ipcMain.on('server-found', (event, address) => {
  serverAddress = address;
  console.log('[AGENT] Сервер найден:', address);
});

ipcMain.on('open-demo', () => openDemoWindow());
ipcMain.on('close-demo', () => closeDemoWindow());
ipcMain.on('open-chat', () => openChatWindow());

ipcMain.on('show-notification', (event, { title, body }) => {
  if (!settings.showNotifications) return;
  new Notification({ title, body }).show();
});

// Для скриншотов
ipcMain.handle('take-screenshot', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 180 }
  });
  return sources[0]?.thumbnail.toJPEG(60).toString('base64');
});

// Для WebRTC стрима экрана (удалённое управление)
ipcMain.handle('get-screen-stream-source', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources[0]?.id || null;
});

// Жизненный цикл
app.whenReady().then(() => {
  loadSettings();
  applyAutoStart();
  createTray();
  createHiddenWindow();

  if (settings.networkMode === 'localhost') {
    serverAddress = 'http://localhost:3000';
    console.log('[AGENT] Режим: localhost');
    notifyWindows();
  } else {
    console.log('[AGENT] Режим: LAN Discovery');
    setTimeout(discoverServer, 1000);
    // Fallback на localhost через 10 секунд, если сервер не найден
    setTimeout(() => {
      if (!serverAddress) {
        serverAddress = 'http://localhost:3000';
        console.log('[AGENT] LAN Discovery не нашёл сервер, fallback на localhost');
        notifyWindows();
      }
    }, 10000);
  }
});

function notifyWindows() {
  if (hiddenWindow && !hiddenWindow.isDestroyed()) {
    hiddenWindow.webContents.send('server-address', serverAddress);
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('server-address', serverAddress);
  }
  if (demoWindow && !demoWindow.isDestroyed()) {
    demoWindow.webContents.send('server-address', serverAddress);
  }
}

// НЕ закрывать приложение при закрытии всех окон — остаёмся в трее
app.on('window-all-closed', () => {
  if (app.isQuitting) {
    app.quit();
  }
});

// LAN Discovery (встроен в main.js)
function discoverServer() {
  const client = dgram.createSocket('udp4');
  
  // Нужно сделать bind перед setBroadcast
  client.bind(() => {
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
        if (hiddenWindow && !hiddenWindow.isDestroyed()) {
            hiddenWindow.webContents.send('server-address', serverAddress);
        }
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send('server-address', serverAddress);
        }
        client.close();
      }
    });

    // Попытка каждые 3 секунды, пока не найдём
    tryDiscover();
    const interval = setInterval(() => {
      if (serverAddress) { clearInterval(interval); return; }
      tryDiscover();
    }, 3000);
  });
}
