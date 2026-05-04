const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const dgram = require('dgram');

let tray = null;
let hiddenWindow = null;  // Фоновое окно (скриншоты, WebRTC)
let chatWindow = null;    // Окно чата
let demoWindow = null;    // Окно демонстрации (fullscreen)
let serverAddress = null; // 'http://IP:PORT'

// Автозапуск с Windows
app.setLoginItemSettings({
  openAtLogin: true,
  path: app.getPath('exe'),
  args: ['--hidden']
});

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  try {
    tray = new Tray(iconPath);
  } catch (err) {
    console.error('[AGENT] Ошибка создания трея (icon.png не найден?):', err.message);
    return;
  }
  tray.setToolTip('ClassControl Agent');

  // ТОЛЬКО пункт "Открыть чат" — ПУНКТА "ВЫХОД" НЕТ!
  const contextMenu = Menu.buildFromTemplate([
    { label: '💬 Открыть беседу', click: () => openChatWindow() }
  ]);
  tray.setContextMenu(contextMenu);
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
  hiddenWindow.webContents.on('console-message', (e, level, msg) => console.log('[HIDDEN LOG]', msg));

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
  
  chatWindow.webContents.on('console-message', (e, level, msg) => console.log('[CHAT LOG]', msg));
  
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

// Для скриншотов
ipcMain.handle('take-screenshot', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 180 }
  });
  return sources[0]?.thumbnail.toJPEG(30).toString('base64');
});

// Жизненный цикл
app.whenReady().then(() => {
  createTray();
  createHiddenWindow();
  
  // Для тестирования на одном ПК - сразу localhost без задержек и Firewall
  serverAddress = 'http://localhost:3000';
  console.log('[AGENT] Используем localhost для сервера:', serverAddress);
  
  // Убираем ожидание discoverServer, но оставляем на всякий случай
  // setTimeout(discoverServer, 1000); 
});

// НЕ закрывать приложение при закрытии всех окон!
app.on('window-all-closed', () => {
  // Пустой обработчик — остаёмся в трее
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
