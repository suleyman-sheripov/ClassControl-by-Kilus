'use strict';
/**
 * ClassControl Agent — работает на компьютере ученика в классе.
 * Иконка в трее с одним пунктом «Открыть беседу». Настройки — только через
 * «Пуск → ClassControl → Настройки агента» и под паролем администратора.
 */
const {
  app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, Notification,
  powerMonitor, screen, shell, session, nativeImage, dialog
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dgram = require('dgram');
const crypto = require('crypto');
const { execFile } = require('child_process');

const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const SHARED_DIR = path.join(RES, 'shared');
const WANT_CONFIG = process.argv.includes('--config');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Агент общается только с компьютером учителя в локальной сети — школьный прокси ему не нужен
// (сайты по команде учителя открываются в обычном браузере ученика).
app.commandLine.appendSwitch('no-proxy-server');

// ---------- Настройки ----------
const SETTINGS_PATH = path.join(app.getPath('userData'), 'agent-settings.json');
const DEFAULTS = {
  pcName: os.hostname(),
  serverMode: 'auto',          // 'auto' — найти учителя в сети, 'manual' — адрес вручную
  serverAddress: '',
  autoStart: true,
  notifications: true,
  passwordHash: '',
  passwordSalt: '',
  lastServer: '',
  room: '',                   // кабинет: агент подключается только к учителю этого кабинета
  stoppedAtBoot: 0            // администратор выключил агент: не поднимать сторожем до перезагрузки
};
let settings = { ...DEFAULTS };
try {
  if (fs.existsSync(SETTINGS_PATH)) settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) };
} catch (e) {}
function saveSettings() {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2)); } catch (e) {}
}
const bootTime = () => Date.now() - os.uptime() * 1000;
function stoppedThisBoot() {
  return settings.stoppedAtBoot && Math.abs(settings.stoppedAtBoot - bootTime()) < 120000;
}
function hashPassword(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('hex');
}
function applyAutoStart() {
  if (process.platform === 'linux') return;
  app.setLoginItemSettings({ openAtLogin: settings.autoStart, path: app.getPath('exe'), args: ['--hidden'] });
}

// ---------- Окна ----------
let tray = null;
let bgWindow = null;        // невидимое окно: связь с сервером, скриншоты, показ экрана
let chatWindow = null;
let demoWindow = null;
let configWindow = null;
let banner = null;          // «Учитель смотрит экран»
let lockWindows = [];
let serverAddress = null;
let connected = false;
let teacherName = 'Учитель';
let agentSocketId = null;
let broadcastState = { active: false, allowExit: false };

const webPrefs = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false
});

function page(name) {
  return path.join(__dirname, 'renderer', name);
}

function sendAll(channel, payload) {
  for (const w of [bgWindow, chatWindow, demoWindow, configWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  try {
    tray = new Tray(icon);
  } catch (err) {
    console.error('[AGENT] Трей недоступен:', err.message);
    return;
  }
  tray.setToolTip('ClassControl — урок');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Открыть беседу', click: openChat }]));
  tray.on('double-click', openChat);
}

function createBackground() {
  bgWindow = new BrowserWindow({ show: false, width: 320, height: 200, webPreferences: webPrefs() });
  bgWindow.loadFile(page('index.html'));
  bgWindow.webContents.on('did-finish-load', () => { if (serverAddress) bgWindow.webContents.send('server-address', serverAddress); });
  bgWindow.webContents.on('render-process-gone', () => setTimeout(createBackground, 2000));
}

function openChat() {
  if (chatWindow && !chatWindow.isDestroyed()) { chatWindow.show(); chatWindow.focus(); return; }
  const { workArea } = screen.getPrimaryDisplay();
  chatWindow = new BrowserWindow({
    width: 380, height: 560, minWidth: 320, minHeight: 400,
    x: workArea.x + workArea.width - 400, y: workArea.y + workArea.height - 580,
    title: 'Беседа урока', backgroundColor: '#0d1210', autoHideMenuBar: true,
    webPreferences: webPrefs()
  });
  chatWindow.setMenuBarVisibility(false);
  chatWindow.loadFile(page('chat.html'));
}

function openDemo() {
  if (demoWindow && !demoWindow.isDestroyed()) return;
  demoWindow = new BrowserWindow({
    fullscreen: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#000000', webPreferences: webPrefs()
  });
  demoWindow.setAlwaysOnTop(true, 'screen-saver');
  demoWindow.loadFile(page('demo.html'));
  demoWindow.on('close', (e) => {
    if (broadcastState.active && !broadcastState.allowExit && !app.isQuitting && !demoWindow.allowClose) e.preventDefault();
  });
  demoWindow.on('closed', () => { demoWindow = null; });
}

function closeDemo(force) {
  if (!demoWindow || demoWindow.isDestroyed()) return;
  if (!force && broadcastState.active && !broadcastState.allowExit) return;
  demoWindow.allowClose = true;
  demoWindow.close();
}

function openConfig() {
  if (configWindow && !configWindow.isDestroyed()) { configWindow.show(); configWindow.focus(); return; }
  configWindow = new BrowserWindow({
    width: 460, height: 620, resizable: false, title: 'ClassControl — настройки агента',
    backgroundColor: '#0d1210', autoHideMenuBar: true, webPreferences: webPrefs()
  });
  configWindow.setMenuBarVisibility(false);
  configWindow.loadFile(page('config.html'));
}

function showBanner(text) {
  if (banner && !banner.isDestroyed()) { banner.webContents.send('banner-text', text); return; }
  const { workArea } = screen.getPrimaryDisplay();
  banner = new BrowserWindow({
    width: 340, height: 40, x: Math.round(workArea.x + workArea.width / 2 - 170), y: workArea.y + 8,
    frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, webPreferences: webPrefs()
  });
  banner.setAlwaysOnTop(true, 'screen-saver');
  banner.setIgnoreMouseEvents(true);
  banner.loadFile(page('banner.html'));
  banner.webContents.on('did-finish-load', () => banner.webContents.send('banner-text', text));
}
function hideBanner() {
  if (banner && !banner.isDestroyed()) banner.close();
  banner = null;
}

// ---------- Блокировка экранов ----------
let lockText = '';
function lockScreens(text) {
  lockText = text || 'Внимание на учителя';
  if (lockWindows.length) { lockWindows.forEach(w => !w.isDestroyed() && w.webContents.send('lock-text', lockText)); return; }
  for (const d of screen.getAllDisplays()) {
    const w = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, fullscreen: true, kiosk: true, alwaysOnTop: true, skipTaskbar: true,
      movable: false, resizable: false, minimizable: false, closable: false,
      backgroundColor: '#0d1210', webPreferences: webPrefs()
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.loadFile(page('lock.html'));
    w.webContents.on('did-finish-load', () => w.webContents.send('lock-text', lockText));
    w.on('close', (e) => { if (!w.allowClose && !app.isQuitting) e.preventDefault(); });
    w.on('blur', () => { if (!w.isDestroyed()) { w.focus(); w.moveTop(); } });
    lockWindows.push(w);
  }
  reportStatus();
}
function unlockScreens() {
  lockWindows.forEach(w => { if (!w.isDestroyed()) { w.allowClose = true; w.setClosable(true); w.close(); } });
  lockWindows = [];
  reportStatus();
}
function reportStatus() {
  if (bgWindow && !bgWindow.isDestroyed()) bgWindow.webContents.send('agent-status', { locked: lockWindows.length > 0 });
}

let messageWindow = null;
function showMessage(text, file) {
  const payload = { text, from: teacherName, file: file || null };
  // Новое сообщение заменяет предыдущее, а не открывает ещё одно окно
  if (messageWindow && !messageWindow.isDestroyed()) {
    messageWindow.webContents.send('message', payload);
    messageWindow.show(); messageWindow.moveTop();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const w = messageWindow = new BrowserWindow({
    width: 420, height: 220, x: Math.round(workArea.x + workArea.width / 2 - 210), y: Math.round(workArea.y + workArea.height / 3 - 110),
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: false, backgroundColor: '#131916',
    title: 'Сообщение от учителя', webPreferences: webPrefs()
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.loadFile(page('message.html'));
  w.webContents.on('did-finish-load', () => w.webContents.send('message', payload));
  w.on('closed', () => { if (messageWindow === w) messageWindow = null; });
}

// ---------- Удалённое управление (nut-js) ----------
let nut = null;
let nutError = null;
function loadNut() {
  if (nut || nutError) return nut;
  try {
    nut = require('@nut-tree-fork/nut-js');
    nut.mouse.config.autoDelayMs = 0;
    nut.mouse.config.mouseSpeed = 100000;
    nut.keyboard.config.autoDelayMs = 0;
  } catch (e) {
    nutError = e.message;
    console.error('[AGENT] nut-js недоступен:', e.message);
  }
  return nut;
}

const KEYMAP = {
  Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', Space: 'Space',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
  ShiftLeft: 'LeftShift', ShiftRight: 'RightShift', ControlLeft: 'LeftControl', ControlRight: 'RightControl',
  AltLeft: 'LeftAlt', AltRight: 'RightAlt', MetaLeft: 'LeftSuper', MetaRight: 'RightSuper', CapsLock: 'CapsLock',
  Minus: 'Minus', Equal: 'Equal', BracketLeft: 'LeftBracket', BracketRight: 'RightBracket', Backslash: 'Backslash',
  Semicolon: 'Semicolon', Quote: 'Quote', Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backquote: 'Grave',
  PrintScreen: 'Print', ContextMenu: 'Menu'
};
function nutKey(code) {
  const K = nut.Key;
  let name = KEYMAP[code];
  if (!name && /^Key[A-Z]$/.test(code)) name = code.slice(3);
  if (!name && /^Digit\d$/.test(code)) name = 'Num' + code.slice(5);
  if (!name && /^F\d{1,2}$/.test(code)) name = code;
  if (!name && /^Numpad\d$/.test(code)) name = 'NumPad' + code.slice(6);
  if (name && K[name] !== undefined) return K[name];
  if (name === 'LeftSuper' && K.LeftWin !== undefined) return K.LeftWin;
  if (name === 'RightSuper' && K.RightWin !== undefined) return K.RightWin;
  return undefined;
}
const BUTTONS = ['LEFT', 'MIDDLE', 'RIGHT'];
let remoteActive = false;
let inputChain = Promise.resolve();

function handleInput(d) {
  if (!remoteActive) return;
  if (!loadNut()) return;
  inputChain = inputChain.then(async () => {
    const { mouse, keyboard, Point, Button } = nut;
    try {
      if (d.type === 'move' || d.type === 'down' || d.type === 'up') {
        const w = await nut.screen.width(), h = await nut.screen.height();
        const x = Math.round(Math.min(1, Math.max(0, d.x)) * (w - 1));
        const y = Math.round(Math.min(1, Math.max(0, d.y)) * (h - 1));
        await mouse.setPosition(new Point(x, y));
        const btn = Button[BUTTONS[d.button] || 'LEFT'];
        if (d.type === 'down') await mouse.pressButton(btn);
        if (d.type === 'up') await mouse.releaseButton(btn);
      } else if (d.type === 'wheel') {
        if (d.dy > 0) await mouse.scrollDown(d.dy * 3);
        if (d.dy < 0) await mouse.scrollUp(-d.dy * 3);
        if (d.dx > 0) await mouse.scrollRight(d.dx * 3);
        if (d.dx < 0) await mouse.scrollLeft(-d.dx * 3);
      } else if (d.type === 'key') {
        const printable = typeof d.key === 'string' && [...d.key].length === 1 && !d.ctrl && !d.alt && !d.meta;
        if (printable) {
          if (d.down) await keyboard.type(d.key);
          return;
        }
        const k = nutKey(String(d.code || ''));
        if (k === undefined) return;
        if (d.down) await keyboard.pressKey(k); else await keyboard.releaseKey(k);
      }
    } catch (err) {
      console.error('[AGENT] input', err.message);
    }
  });
}

// ---------- Программы и питание ----------
const PROTECTED = new Set(['explorer.exe', 'csrss.exe', 'winlogon.exe', 'lsass.exe', 'services.exe', 'svchost.exe', 'dwm.exe', 'smss.exe', 'wininit.exe', 'system']);

function listProcesses() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const ps = "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress";
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000, maxBuffer: 4e6 }, (err, out) => {
        if (err) return resolve([]);
        try {
          let list = JSON.parse(out || '[]');
          if (!Array.isArray(list)) list = [list];
          resolve(list
            .filter(p => p.Id !== process.pid)
            .map(p => ({ pid: p.Id, name: p.ProcessName + '.exe', title: p.MainWindowTitle })));
        } catch (e) { resolve([]); }
      });
    } else {
      execFile('ps', ['-u', String(os.userInfo().uid), '-o', 'pid=,comm='], { timeout: 5000 }, (err, out) => {
        if (err) return resolve([]);
        resolve(String(out).trim().split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length >= 2 && Number(p[0]) !== process.pid)
          .map(p => ({ pid: Number(p[0]), name: p[1], title: '' })).slice(0, 150));
      });
    }
  });
}

function killProcess({ pid, name }) {
  return new Promise((resolve) => {
    const lname = String(name || '').toLowerCase();
    if (PROTECTED.has(lname) || pid === process.pid || pid === process.ppid) return resolve({ ok: false, message: 'Эту программу закрыть нельзя' });
    if (process.platform === 'win32') {
      const args = pid ? ['/PID', String(pid), '/T', '/F'] : ['/IM', lname, '/T', '/F'];
      execFile('taskkill', args, { windowsHide: true }, (err) => resolve({ ok: !err, message: err ? 'Не удалось закрыть программу' : '' }));
    } else {
      try { process.kill(pid, 'SIGTERM'); resolve({ ok: true }); } catch (e) { resolve({ ok: false, message: e.message }); }
    }
  });
}

function power(mode) {
  const win = {
    shutdown: ['shutdown', ['/s', '/t', '15', '/c', 'Учитель выключает компьютер. Сохраните работу.']],
    restart: ['shutdown', ['/r', '/t', '15', '/c', 'Учитель перезагружает компьютер. Сохраните работу.']],
    logoff: ['shutdown', ['/l']]
  };
  const nix = { shutdown: ['systemctl', ['poweroff']], restart: ['systemctl', ['reboot']], logoff: ['loginctl', ['terminate-user', os.userInfo().username]] };
  const cmd = (process.platform === 'win32' ? win : nix)[mode];
  if (!cmd) return;
  execFile(cmd[0], cmd[1], { windowsHide: true }, () => {});
}

async function handleControl({ action, data }) {
  const reply = (ok, message) => bgWindow && !bgWindow.isDestroyed() && bgWindow.webContents.send('control-result', { action, ok, message });
  switch (action) {
    case 'input': handleInput(data || {}); break;
    case 'lock': lockScreens(data && data.text); break;
    case 'unlock': unlockScreens(); break;
    case 'message': showMessage(String((data && data.text) || '')); break;
    case 'open-url':
      if (data && /^https?:\/\//i.test(data.url)) shell.openExternal(data.url).catch(() => reply(false, 'Не удалось открыть сайт'));
      break;
    case 'list-processes': {
      const list = await listProcesses();
      if (bgWindow && !bgWindow.isDestroyed()) bgWindow.webContents.send('processes', list);
      break;
    }
    case 'kill': {
      const r = await killProcess(data || {});
      if (!r.ok) reply(false, r.message);
      break;
    }
    case 'power': power(data && data.mode); break;
  }
}

// ---------- Скриншоты для мониторинга ----------
let lastHash = '';
let lastSent = 0;
async function takeScreenshot() {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 640, height: 360 } });
  const primary = sources.find(s => String(s.display_id) === String(screen.getPrimaryDisplay().id)) || sources[0];
  if (!primary) return null;
  const jpeg = primary.thumbnail.toJPEG(62);
  const hash = crypto.createHash('md5').update(jpeg).digest('hex');
  const now = Date.now();
  const idle = powerMonitor.getSystemIdleTime();
  // Экран не менялся — шлём не чаще раза в 5 секунд (как «пульс» и для времени бездействия)
  if (hash === lastHash && now - lastSent < 5000) return { image: null, idle };
  lastHash = hash;
  lastSent = now;
  return { image: jpeg, idle };
}

// ---------- Поиск учителя в сети ----------
let discoverTimer = null;
let queryClient = null;
let listener = null;

function setServer(address) {
  if (!address || address === serverAddress) return;
  serverAddress = address;
  console.log('[AGENT] Сервер урока:', address);
  sendAll('server-address', address);
}

function startDiscovery() {
  if (settings.serverMode === 'manual' && settings.serverAddress) {
    const a = settings.serverAddress.trim();
    setServer(/^https?:\/\//.test(a) ? a : `http://${a.includes(':') ? a : a + ':3000'}`);
    return;
  }
  if (!listener) {
    listener = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    listener.on('message', (msg) => onAnnounce(String(msg)));
    listener.on('error', () => {});
    try { listener.bind(41235); } catch (e) {}
  }
  if (!queryClient) {
    queryClient = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    queryClient.on('message', (msg) => onAnnounce(String(msg)));
    queryClient.on('error', () => {});
    queryClient.bind(() => { try { queryClient.setBroadcast(true); } catch (e) {} });
  }
  const ask = () => {
    if (connected) return;
    const msg = Buffer.from('CLASSCONTROL_DISCOVER');
    try { queryClient.send(msg, 41234, '255.255.255.255'); } catch (e) {}
  };
  clearInterval(discoverTimer);
  discoverTimer = setInterval(ask, 3000);
  setTimeout(ask, 300);
}

const discovered = new Map(); // адрес -> время последнего ответа (для окна настроек)
let chosenAt = 0;
const ignored = new Map();    // адрес учителя -> до какого времени не подключаться («это не мой компьютер»)
const normRoom = (r) => String(r || '').trim().toLowerCase().replace(/\s+/g, ' ');
function ignoreServer(address, minutes) {
  if (!address) return;
  ignored.set(address, Date.now() + minutes * 60000);
  if (settings.lastServer === address) { settings.lastServer = ''; saveSettings(); }
  if (serverAddress === address) { serverAddress = null; connected = false; }
}
function onAnnounce(text) {
  if (!text.startsWith('CLASSCONTROL_SERVER:')) return;
  const [, ip, port, roomEnc = '', teacherEnc = ''] = text.split(':');
  if (!ip || !port) return;
  let room = '', teacher = '';
  try { room = decodeURIComponent(roomEnc); teacher = decodeURIComponent(teacherEnc); } catch (e) {}
  const address = `http://${ip}:${port}`;
  const now = Date.now();
  discovered.set(address, { ts: now, room, teacher });
  if (settings.serverMode === 'manual') return;
  if (connected && serverAddress) return;
  if ((ignored.get(address) || 0) > now) return;
  // ПК закреплён за кабинетом — к учителям других кабинетов не подключается
  if (settings.room && normRoom(room) !== normRoom(settings.room)) return;
  const seen = (a) => discovered.has(a) && now - discovered.get(a).ts < 10000;
  // В одной сети может быть несколько кабинетов. Не прыгаем между учителями:
  // предпочитаем того, с кем были на связи в прошлый раз, а выбранного держим 15 секунд.
  if (settings.lastServer && address !== settings.lastServer && seen(settings.lastServer) &&
      (ignored.get(settings.lastServer) || 0) <= now) return;
  if (serverAddress && serverAddress !== address && now - chosenAt < 15000 && address !== settings.lastServer) return;
  if (serverAddress !== address) chosenAt = now;
  setServer(address);
}


// ---------- Кто за компьютером ----------
let studentName = null;       // кто за ПК на этом уроке
let lessonId = null;          // урок, на котором ученик представился
let studentAsked = false;
let uploadToken = '';
let helloWindow = null;
function openHello() {
  if (helloWindow && !helloWindow.isDestroyed()) { helloWindow.show(); helloWindow.focus(); return; }
  const { workArea } = screen.getPrimaryDisplay();
  helloWindow = new BrowserWindow({
    width: 420, height: 380, x: Math.round(workArea.x + workArea.width / 2 - 210), y: Math.round(workArea.y + workArea.height / 3 - 190),
    frame: false, resizable: false, alwaysOnTop: true, backgroundColor: '#131916', title: 'Кто за компьютером?', webPreferences: webPrefs()
  });
  helloWindow.loadFile(page('hello.html'));
  helloWindow.on('closed', () => { helloWindow = null; });
}
// Ученик представляется: сервер может спросить «вы пересели с другого места?»
ipcMain.on('set-student', (e, { name, confirm } = {}) => {
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) { if (helloWindow && !helloWindow.isDestroyed()) helloWindow.close(); return; }
  if (!connected) {
    // Связи нет — запомним, сервер узнает при подключении
    studentName = clean;
    if (helloWindow && !helloWindow.isDestroyed()) helloWindow.close();
    return;
  }
  if (bgWindow && !bgWindow.isDestroyed()) bgWindow.webContents.send('introduce', { name: clean, confirm: Boolean(confirm) });
});
ipcMain.on('introduce-result', (e, r) => {
  if (r && r.ok) {
    studentName = r.student || null;
    if (helloWindow && !helloWindow.isDestroyed()) helloWindow.close();
    sendAll('connection-state', { connected, teacherName, socketId: agentSocketId, student: studentName });
  } else if (r && r.taken && helloWindow && !helloWindow.isDestroyed()) {
    helloWindow.webContents.send('hello-taken', { name: r.name, where: r.where });
  }
});
// Место освободили (ученик пересел или учитель пересадил) — новый человек за ПК представится
ipcMain.on('seat-changed', (e, d) => {
  if (d.quiet && !studentName) return;
  studentName = d.student || null;
  sendAll('connection-state', { connected, teacherName, socketId: agentSocketId, student: studentName });
  if (!studentName) { studentAsked = true; openHello(); }
  else if (helloWindow && !helloWindow.isDestroyed()) helloWindow.close();
});
ipcMain.on('lesson-id', (e, id) => { lessonId = id || null; });
let classRoster = [];
ipcMain.on('roster', (e, list) => { classRoster = Array.isArray(list) ? list : []; });
ipcMain.handle('get-roster', () => classRoster);
// Окна агента (беседа) отправляют события через подключение фонового окна
ipcMain.on('socket-emit-out', (e, msg) => {
  if (bgWindow && !bgWindow.isDestroyed()) bgWindow.webContents.send('socket-emit', msg);
  if (msg.event === 'raise-hand') sendAll('hand-state', Boolean(msg.data));
});
ipcMain.on('hand-lowered', () => sendAll('hand-state', false));
ipcMain.on('hello-skip', () => { if (helloWindow && !helloWindow.isDestroyed()) helloWindow.close(); });
ipcMain.on('open-hello', openHello);

// ---------- Учитель пропал: через минуту снимаем блокировку и управление ----------
let teacherGoneTimer = null;
function teacherGone() {
  if (teacherGoneTimer) return;
  teacherGoneTimer = setTimeout(() => {
    teacherGoneTimer = null;
    // Ученик не должен остаться с заблокированным экраном, если приложение учителя закрылось или упало
    unlockScreens();
    remoteActive = false;
    hideBanner();
  }, Number(process.env.CLASSCONTROL_TEACHER_GRACE_MS) || 60000);
}
ipcMain.on('teacher-gone', teacherGone);
ipcMain.on('teacher-back', () => { clearTimeout(teacherGoneTimer); teacherGoneTimer = null; });
ipcMain.on('request-status', reportStatus);

// ---------- «Это не мой компьютер» и закрепление за кабинетом ----------
ipcMain.on('released', () => {
  ignoreServer(serverAddress || settings.lastServer, 30);
  sendAll('connection-state', { connected: false, teacherName, socketId: null });
});
ipcMain.on('room-mismatch', () => ignoreServer(serverAddress, 30));
ipcMain.on('bind-room', (e, { room }) => {
  if (settings.room || !room) return;
  settings.room = String(room).slice(0, 60);
  saveSettings();
});

// ---------- IPC ----------
ipcMain.handle('agent-info', () => ({
  pcName: settings.pcName || os.hostname(),
  hostname: os.hostname(),
  platform: process.platform,
  serverAddress,
  connected,
  teacherName,
  socketId: agentSocketId,
  uploadToken,
  room: settings.room,
  student: studentName,
  lessonId,
  broadcast: broadcastState
}));
ipcMain.handle('get-idle', () => powerMonitor.getSystemIdleTime());
ipcMain.handle('take-screenshot', takeScreenshot);
ipcMain.on('connection-state', (e, s) => {
  connected = Boolean(s.connected);
  if (connected && serverAddress && settings.lastServer !== serverAddress) {
    settings.lastServer = serverAddress;
    saveSettings();
  }
  agentSocketId = s.socketId || null;
  if (s.uploadToken) uploadToken = s.uploadToken;
  if (s.lessonId) lessonId = s.lessonId;
  if (s.teacherName) teacherName = s.teacherName;
  if (connected) {
    clearTimeout(teacherGoneTimer); teacherGoneTimer = null;
    reportStatus();
    // Кто за компьютером? Спрашиваем один раз за запуск, когда начался урок
    if (studentName === null && !studentAsked) { studentAsked = true; openHello(); }
  } else {
    teacherGone();
  }
  if (tray) tray.setToolTip(connected ? `ClassControl — на связи с ${teacherName}` : 'ClassControl — ищу учителя…');
  sendAll('connection-state', { connected, teacherName, socketId: agentSocketId });
});
ipcMain.on('control', (e, cmd) => handleControl(cmd));
ipcMain.on('remote-session', (e, on) => {
  remoteActive = Boolean(on);
  if (on) { loadNut(); showBanner('Учитель подключился к вашему экрану'); } else hideBanner();
});
ipcMain.on('broadcast', (e, st) => {
  broadcastState = { active: Boolean(st.active), allowExit: Boolean(st.allowExit) };
  if (broadcastState.active) openDemo(); else closeDemo(true);
  if (demoWindow && !demoWindow.isDestroyed()) demoWindow.webContents.send('broadcast-state', broadcastState);
});
ipcMain.on('close-demo', () => closeDemo(false));
ipcMain.on('open-chat', openChat);
ipcMain.on('notify', (e, { title, body }) => {
  if (!settings.notifications || !Notification.isSupported()) return;
  if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isFocused()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', openChat);
  n.show();
});
// Чат идёт через подключение фонового окна: от имени этого компьютера
ipcMain.on('chat-send', (e, msg) => { if (bgWindow && !bgWindow.isDestroyed()) bgWindow.webContents.send('chat-send', msg); });
ipcMain.on('chat-event', (e, ev) => { if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.send('chat-event', ev); });
ipcMain.on('chat-request-history', () => { if (bgWindow && !bgWindow.isDestroyed()) bgWindow.webContents.send('chat-request-history'); });
ipcMain.on('message-close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });

// ---------- Задания учителя: файл на рабочий стол ----------
const TASKS_DIR = path.join(app.getPath('desktop'), 'Задания');
function uniquePath(dir, name) {
  const safe = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150) || 'файл';
  const ext = path.extname(safe), base = safe.slice(0, safe.length - ext.length);
  let p = path.join(dir, safe);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}
ipcMain.on('assignment', async (e, item) => {
  try {
    if (!/^https?:\/\//.test(item.url) || !serverAddress || !item.url.startsWith(serverAddress)) return;
    fs.mkdirSync(TASKS_DIR, { recursive: true });
    const res = await fetch(item.url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const dest = uniquePath(TASKS_DIR, item.filename);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    showMessage(`Новое задание: «${item.filename}». Файл лежит на рабочем столе в папке «Задания».`, dest);
  } catch (err) {
    console.error('[AGENT] Задание не скачалось:', err.message);
  }
});
ipcMain.on('open-file', (e, p) => {
  // Открываем только файлы из папки заданий
  const full = path.resolve(String(p || ''));
  if (full.startsWith(TASKS_DIR + path.sep)) shell.openPath(full);
  else if (full === TASKS_DIR) shell.openPath(TASKS_DIR);
});

// ---------- Опрос и сдача работы: отдельное небольшое окно ----------
let taskWindow = null;
let currentTasks = { poll: null, collect: null };
function sendTask() {
  if (taskWindow && !taskWindow.isDestroyed()) taskWindow.webContents.send('task', currentTasks);
}
function openTaskWindow() {
  if (taskWindow && !taskWindow.isDestroyed()) { sendTask(); taskWindow.show(); taskWindow.focus(); return; }
  const { workArea } = screen.getPrimaryDisplay();
  taskWindow = new BrowserWindow({
    width: 420, height: 460, x: workArea.x + workArea.width - 440, y: workArea.y + 20,
    resizable: false, minimizable: false, maximizable: false, alwaysOnTop: true, frame: false,
    title: 'Задание от учителя', backgroundColor: '#131916', webPreferences: webPrefs()
  });
  taskWindow.setAlwaysOnTop(true, 'floating');
  taskWindow.loadFile(page('task.html'));
  taskWindow.webContents.on('did-finish-load', sendTask);
  taskWindow.on('closed', () => { taskWindow = null; });
}
function updateTray() {
  if (!tray) return;
  const items = [{ label: 'Открыть беседу', click: openChat }];
  if (currentTasks.poll && currentTasks.poll.open !== false) items.push({ label: 'Ответить на опрос', click: openTaskWindow });
  if (currentTasks.collect) items.push({ label: 'Сдать работу', click: openTaskWindow });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}
ipcMain.on('task', (e, t) => {
  if (t.type === 'reset') { currentTasks = { poll: null, collect: null }; if (taskWindow && !taskWindow.isDestroyed()) taskWindow.close(); }
  if (t.type === 'poll') { currentTasks.poll = { ...t.poll, open: true }; openTaskWindow(); }
  if (t.type === 'poll-closed') {
    if (currentTasks.poll && currentTasks.poll.id === t.poll.id) {
      currentTasks.poll = t.poll.share ? { ...t.poll, open: false } : null;
      if (currentTasks.poll || currentTasks.collect) sendTask();
      else if (taskWindow && !taskWindow.isDestroyed()) taskWindow.close();
    }
  }
  if (t.type === 'collect') { currentTasks.collect = t.collection; openTaskWindow(); }
  if (t.type === 'collect-closed') {
    if (currentTasks.collect && (!t.collection || !t.collection.id || currentTasks.collect.id === t.collection.id)) {
      currentTasks.collect = null;
      if (currentTasks.poll) sendTask(); else if (taskWindow && !taskWindow.isDestroyed()) taskWindow.close();
    }
  }
  updateTray();
});
ipcMain.on('task-answer', (e, { pollId, option }) => {
  if (!currentTasks.poll || currentTasks.poll.id !== pollId) return;
  currentTasks.poll.myVote = option;
  if (bgWindow && !bgWindow.isDestroyed()) bgWindow.webContents.send('socket-emit', { event: 'poll-answer', data: { id: pollId, option } });
});
ipcMain.handle('task-submit', async (e, collectId) => {
  if (!currentTasks.collect || currentTasks.collect.id !== collectId) return { ok: false, error: 'Сбор работ закончен' };
  const r = await dialog.showOpenDialog(taskWindow || undefined, { title: 'Выберите файл с работой', defaultPath: app.getPath('documents'), properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const file = r.filePaths[0];
  try {
    const stat = fs.statSync(file);
    if (stat.size > 50 * 1024 * 1024) return { ok: false, error: 'Файл больше 50 МБ' };
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
    const res = await fetch(`${serverAddress}/submit?socketId=${encodeURIComponent(agentSocketId || '')}&token=${encodeURIComponent(uploadToken || '')}&collect=${encodeURIComponent(collectId)}`, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || 'Не удалось сдать работу' };
    currentTasks.collect.submitted = data.filename;
    return { ok: true, filename: data.filename };
  } catch (err) {
    return { ok: false, error: 'Нет связи с учителем' };
  }
});
ipcMain.on('task-close', () => { if (taskWindow && !taskWindow.isDestroyed()) taskWindow.close(); });

// ---------- Режим «Фокус»: заголовок активного окна ----------
let focusCfg = { enabled: false, words: [] };
// nut-js в некоторых системах отдаёт UTF-8 как latin1 («ÐšÐ¾Ñ‚…») — чиним, чтобы находились русские слова
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
function fixMojibake(str) {
  if (!/[\u00c3\u00d0\u00d1\u00e2]/.test(str)) return str;
  const bytes = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x100) bytes.push(c);
    else if (CP1252[c] !== undefined) bytes.push(CP1252[c]);
    else return str;            // это не «перекодированный» текст — оставляем как есть
  }
  const fixed = Buffer.from(bytes).toString('utf8');
  return fixed.includes('\ufffd') ? str : fixed;
}
let focusTimer = null;
let focusLast = null;
ipcMain.on('set-focus', (e, f) => {
  focusCfg = { enabled: Boolean(f && f.enabled), words: (f && f.words) || [] };
  clearInterval(focusTimer);
  focusTimer = null;
  if (!focusCfg.enabled) { focusLast = null; return; }
  if (!loadNut() || typeof nut.getActiveWindow !== 'function') return;
  focusTimer = setInterval(async () => {
    try {
      const w = await nut.getActiveWindow();
      const title = fixMojibake(String(await w.title || ''));
      const low = title.toLowerCase();
      const hit = focusCfg.words.some(word => word && low.includes(word)) ? title : null;
      if (hit !== focusLast) {
        focusLast = hit;
        if (bgWindow && !bgWindow.isDestroyed()) bgWindow.webContents.send('socket-emit', { event: 'focus-violation', data: { title: hit } });
      }
    } catch (err) { /* окна нет — пропускаем */ }
  }, 3000);
});

// Настройки под паролем
let configUnlocked = false;
ipcMain.handle('config-state', () => ({ hasPassword: Boolean(settings.passwordHash), unlocked: configUnlocked }));
ipcMain.handle('config-unlock', (e, pw) => {
  if (!settings.passwordHash) {
    if (!pw || String(pw).length < 4) return { ok: false, error: 'Пароль — минимум 4 символа' };
    settings.passwordSalt = crypto.randomBytes(16).toString('hex');
    settings.passwordHash = hashPassword(pw, settings.passwordSalt);
    saveSettings();
    configUnlocked = true;
    return { ok: true };
  }
  const ok = crypto.timingSafeEqual(Buffer.from(hashPassword(pw, settings.passwordSalt), 'hex'), Buffer.from(settings.passwordHash, 'hex'));
  configUnlocked = ok;
  return ok ? { ok: true } : { ok: false, error: 'Неверный пароль' };
});
ipcMain.handle('config-get', () => {
  if (!configUnlocked) return null;
  const { passwordHash, passwordSalt, ...rest } = settings;
  const now = Date.now();
  const found = [...discovered].filter(([, d]) => now - d.ts < 15000).map(([a, d]) => ({ address: a, room: d.room, teacher: d.teacher }));
  return { ...rest, hostname: os.hostname(), serverAddressNow: serverAddress, connected, found };
});
ipcMain.handle('config-save', (e, patch) => {
  if (!configUnlocked) return false;
  for (const k of ['pcName', 'serverMode', 'serverAddress', 'autoStart', 'notifications', 'room']) {
    if (patch[k] !== undefined) settings[k] = patch[k];
  }
  settings.pcName = String(settings.pcName || '').trim().slice(0, 40) || os.hostname();
  saveSettings();
  applyAutoStart();
  serverAddress = null;
  connected = false;
  startDiscovery();
  if (bgWindow && !bgWindow.isDestroyed()) bgWindow.webContents.reload();
  return true;
});
ipcMain.handle('config-quit', () => {
  if (!configUnlocked) return false;
  settings.stoppedAtBoot = bootTime();
  saveSettings();
  app.isQuitting = true;
  unlockScreens();
  app.quit();
  return true;
});
ipcMain.on('config-lock', () => { configUnlocked = false; });

// ---------- Жизненный цикл ----------
app.on('second-instance', (e, argv) => {
  // Сторож из планировщика Windows запускает агент раз в минуту: если он уже работает — ничего не делаем
  if (argv.includes('--watchdog') || argv.includes('--hidden')) return;
  if (argv.includes('--config')) openConfig(); else openChat();
});

// Сторож запустил агент, а администратор выключил его до перезагрузки — выходим сразу
if (process.argv.includes('--watchdog') && stoppedThisBoot()) {
  app.quit();
} else if (settings.stoppedAtBoot && !process.argv.includes('--watchdog')) {
  settings.stoppedAtBoot = 0;   // запустили вручную — снова работаем
  saveSettings();
}

app.whenReady().then(() => {
  if (process.argv.includes('--watchdog') && stoppedThisBoot()) return;
  // Показ экрана учителю: всегда весь основной экран, без системного окна выбора
  session.defaultSession.setDisplayMediaRequestHandler(async (req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const primary = sources.find(s => String(s.display_id) === String(screen.getPrimaryDisplay().id)) || sources[0];
      cb({ video: primary });
    } catch (e) { cb({}); }
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'display-capture', 'notifications', 'fullscreen'].includes(perm)));

  applyAutoStart();
  createTray();
  createBackground();
  startDiscovery();
  if (WANT_CONFIG) openConfig();
});

app.on('window-all-closed', () => { /* остаёмся в трее */ });
app.on('before-quit', () => { app.isQuitting = true; });

module.exports = { SHARED_DIR };
