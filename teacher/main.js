'use strict';
const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

// ---------- Пути (разработка и собранное приложение) ----------
const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const SERVER_PATH = path.join(RES, 'server', 'server.js');
const ONLINE_DIR = path.join(RES, 'online');
const SHARED_DIR = path.join(RES, 'shared');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let lessonServer = null;
let previousReport = null;
let serverError = null;
let pendingSourceId = null;
let awakeId = null;

// ---------- Настройки ----------
const SETTINGS_PATH = path.join(app.getPath('userData'), 'teacher-settings.json');
const DEFAULTS = {
  teacherName: 'Учитель',
  roomName: '',
  lessonCode: '',
  onboarded: false,
  recordDir: path.join(app.getPath('videos'), 'ClassControl'),
  reportDir: path.join(app.getPath('documents'), 'ClassControl'),
  remoteAccess: false,
  quality: '1280x720',
  fps: 15,
  allowExit: false,
  shareAudio: true,
  shareMic: false,
  theme: 'dark',
  rosters: {}                 // кабинет -> список класса
};
let settings = { ...DEFAULTS };
try {
  if (fs.existsSync(SETTINGS_PATH)) settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) };
} catch (e) { /* остаются значения по умолчанию */ }

function saveSettings() {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2)); } catch (e) {}
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// ---------- Окно ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'ClassControl',
    backgroundColor: '#0d1210',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Внешние ссылки открываем в браузере, а не внутри приложения
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); }
  });

  mainWindow.on('close', (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Закрыть ClassControl',
      message: 'Закрыть ClassControl?',
      detail: 'Ученики отключатся, эфир и запись остановятся. Чат и доска сохранятся до следующего запуска.',
      buttons: ['Отмена', 'Закрыть'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then(({ response }) => {
      if (response === 1) { app.isQuitting = true; app.quit(); }
    });
  });

  // Выбор окна или экрана для эфира: источник выбирается в интерфейсе заранее
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const chosen = sources.find(s => s.id === pendingSourceId) || sources.find(s => s.id.startsWith('screen')) || sources[0];
      const wantAudio = request.audioRequested && process.platform === 'win32';
      callback(wantAudio ? { video: chosen, audio: 'loopback' } : { video: chosen });
    } catch (err) {
      callback({});
    }
  }, { useSystemPicker: false });

  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'display-capture', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(permission));
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    const { start } = require(SERVER_PATH);
    lessonServer = await start({
      dataDir: path.join(app.getPath('userData'), 'lesson'),
      onlineDir: ONLINE_DIR,
      sharedDir: SHARED_DIR,
      teacherName: settings.teacherName,
      roomName: settings.roomName,
      lessonCode: settings.lessonCode || undefined,
      roster: (settings.rosters || {})[settings.roomName] || [],
      log: (...a) => console.log('[SERVER]', ...a)
    });
    // Код урока постоянный для этого учителя: ссылка и QR в кабинете работают каждый день
    if (!settings.lessonCode) { settings.lessonCode = lessonServer.lessonCode; saveSettings(); }
    // Урок, который остался с прошлого раза, сохраняем в отчёт и начинаем новый
    const prev = lessonServer.takePreviousLesson();
    if (prev) {
      try { previousReport = { dir: writeReport(prev, null), strokes: prev.strokes || [] }; } catch (e) { console.error('[TEACHER] отчёт прошлого урока:', e); }
    }
  } catch (err) {
    serverError = err.message;
    console.error('[TEACHER] Сервер не запустился:', err);
  }
  createWindow();
  if (settings.remoteAccess) startTunnel();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopTunnel();
  closeRecording();
});

app.on('window-all-closed', () => app.quit());

// ---------- IPC: базовое ----------
ipcMain.handle('boot', () => ({
  port: lessonServer ? lessonServer.port : null,
  token: lessonServer ? lessonServer.token : '',
  serverError,
  settings,
  platform: process.platform,
  version: app.getVersion(),
  tunnel: tunnelState,
  previousReport
}));

ipcMain.handle('save-settings', (e, patch) => {
  const allowed = Object.keys(DEFAULTS);
  for (const k of Object.keys(patch || {})) if (allowed.includes(k)) settings[k] = patch[k];
  saveSettings();
  if (lessonServer) lessonServer.setLesson({ roomName: settings.roomName, teacherName: settings.teacherName, lessonCode: settings.lessonCode, roster: (settings.rosters || {})[settings.roomName] || [] });
  return settings;
});

// Новый код урока (если старая ссылка попала не к тем людям)
ipcMain.handle('new-lesson-code', () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  settings.lessonCode = [...require('crypto').randomBytes(6)].map(b => A[b % A.length]).join('');
  saveSettings();
  if (lessonServer) lessonServer.setLesson({ lessonCode: settings.lessonCode });
  return settings.lessonCode;
});

// Картинка доски для отчёта прошлого урока (рисует окно учителя)
ipcMain.handle('report-board', (e, { dir, png }) => {
  if (!previousReport || dir !== previousReport.dir || !png || !png.startsWith('data:image/png;base64,')) return false;
  fs.writeFileSync(path.join(dir, 'Доска.png'), Buffer.from(png.split(',')[1], 'base64'));
  previousReport = null;
  return true;
});

ipcMain.handle('pick-folder', async (e, current) => {
  const r = await dialog.showOpenDialog(mainWindow, { defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
  const ownId = mainWindow ? mainWindow.getMediaSourceId() : '';
  return sources
    .filter(s => s.id !== ownId)
    .map(s => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : ''
    }));
});

ipcMain.handle('set-share-source', (e, id) => { pendingSourceId = id || null; return true; });
ipcMain.handle('own-window-source', () => (mainWindow ? mainWindow.getMediaSourceId() : null));

ipcMain.handle('keep-awake', (e, on) => {
  if (on && awakeId === null) awakeId = powerSaveBlocker.start('prevent-display-sleep');
  if (!on && awakeId !== null) { powerSaveBlocker.stop(awakeId); awakeId = null; }
  return true;
});

ipcMain.handle('open-path', (e, p) => { if (p) shell.showItemInFolder(p); });
ipcMain.handle('open-folder', (e, p) => {
  if (!p) return;
  fs.mkdirSync(p, { recursive: true });
  return shell.openPath(p);
});
ipcMain.handle('open-external', (e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

// ---------- Запись урока: пишем на диск частями, а не в память ----------
let recStream = null;
let recPath = null;

function closeRecording() {
  if (recStream) {
    try { recStream.end(); } catch (e) {}
  }
  recStream = null;
}

ipcMain.handle('rec-start', () => {
  closeRecording();
  fs.mkdirSync(settings.recordDir, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
  recPath = path.join(settings.recordDir, `Урок ${stamp}.webm`);
  recStream = fs.createWriteStream(recPath);
  return recPath;
});

ipcMain.on('rec-chunk', (e, chunk) => {
  if (recStream && chunk) recStream.write(Buffer.from(chunk));
});

ipcMain.handle('rec-stop', () => new Promise((resolve) => {
  if (!recStream) return resolve(recPath);
  const p = recPath;
  recStream.end(() => resolve(p));
  recStream = null;
}));

// ---------- Отчёт урока ----------
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('ru-RU');
}

ipcMain.handle('lesson-save', async (e, { boardPng } = {}) => {
  if (!lessonServer) return null;
  return writeReport(lessonServer.getLessonSnapshot(), boardPng);
});

function writeReport(snap, boardPng) {
  const d = new Date(snap.lessonStartedAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
  const dir = path.join(settings.reportDir, `Урок ${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  // Посещаемость по людям: где сидел (с пересадками), сколько был; кто из списка класса не пришёл
  const rows = [['Ученик', 'Где', 'Пришёл', 'Ушёл', 'Минут на уроке']];
  const people = new Map();
  const anonymousSeats = new Set(), namedSeats = new Set();
  for (const a of snap.attendance) {
    if (a.anonymous) { anonymousSeats.add(a.seat || a.name); continue; }
    if (a.seat) namedSeats.add(a.seat);
    const key = String(a.name).toLowerCase().replace(/ё/g, 'е');
    const p = people.get(key) || { name: a.name, seats: [], from: a.joinedAt, to: 0, ms: 0 };
    if (!p.seats.length || p.seats[p.seats.length - 1] !== (a.seat || (a.role === 'online' ? 'из дома' : ''))) p.seats.push(a.seat || (a.role === 'online' ? 'из дома' : ''));
    const end = a.leftAt || snap.endedAt;
    p.from = Math.min(p.from, a.joinedAt);
    p.to = Math.max(p.to, end);
    p.ms += end - a.joinedAt;
    people.set(key, p);
  }
  [...people.values()].sort((x, y) => x.name.localeCompare(y.name, 'ru')).forEach(p => {
    rows.push([p.name, p.seats.filter(Boolean).join(' → '), fmt(p.from), fmt(p.to), Math.round(p.ms / 60000)]);
  });
  for (const n of (snap.roster || [])) {
    if (!people.has(String(n).toLowerCase().replace(/ё/g, 'е'))) rows.push([n, 'не был на уроке', '', '', 0]);
  }
  const silent = [...anonymousSeats].filter(seat => !namedSeats.has(seat));
  if (silent.length) rows.push(['', 'Компьютеры, за которыми никто не представился: ' + silent.join(', '), '', '', '']);
  fs.writeFileSync(path.join(dir, 'Посещаемость.csv'), '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'));

  // Чат
  const lines = snap.chat.map(m => {
    const t = new Date(m.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (m.type === 'system') return `[${t}] — ${m.text}`;
    const priv = m.to ? ` → ${m.toName || 'учителю'} (лично)` : '';
    const body = m.type === 'file' ? `[файл] ${m.filename}` : m.text;
    return `[${t}] ${m.sender}${priv}: ${body}`;
  });
  fs.writeFileSync(path.join(dir, 'Чат.txt'), '﻿' + `Урок: ${fmt(snap.lessonStartedAt)} — ${fmt(snap.endedAt)}\r\nУчитель: ${snap.teacherName}\r\n\r\n` + lines.join('\r\n'));

  // Файлы из чата
  const files = snap.chat.filter(m => m.type === 'file');
  if (files.length) {
    const fdir = path.join(dir, 'Файлы');
    fs.mkdirSync(fdir, { recursive: true });
    for (const f of files) {
      const src = path.join(snap.uploadDir, path.basename(f.url));
      const safe = String(f.filename).replace(/[\\/:*?"<>|]/g, '_');
      try { if (fs.existsSync(src)) fs.copyFileSync(src, path.join(fdir, safe)); } catch (err) {}
    }
  }

  // Опросы
  if (snap.polls && snap.polls.length) {
    const txt = snap.polls.slice().reverse().map(p => {
      const lines = p.options.map((o, i) => `  ${o}: ${p.counts[i] || 0}`);
      const who = (p.voters || []).map(v => `  ${v.name} — ${p.options[v.option]}`);
      return `${p.question}\r\nОтветили: ${p.total}\r\n${lines.join('\r\n')}\r\n\r\nКто как ответил:\r\n${who.join('\r\n') || '  —'}`;
    }).join('\r\n\r\n');
    fs.writeFileSync(path.join(dir, 'Опросы.txt'), '\uFEFF' + txt);
  }

  // Собранные работы: копия папок сбора с понятными именами
  for (const c of snap.collections || []) {
    if (!c.submissions.length) continue;
    const target = path.join(dir, 'Работы', String(c.title).replace(/[\\/:*?"<>|]/g, '_'));
    fs.mkdirSync(target, { recursive: true });
    for (const sub of c.submissions) {
      try { fs.copyFileSync(path.join(c.dir, sub.stored), path.join(target, sub.stored)); } catch (err) {}
    }
  }

  if (boardPng && boardPng.startsWith('data:image/png;base64,')) {
    fs.writeFileSync(path.join(dir, 'Доска.png'), Buffer.from(boardPng.split(',')[1], 'base64'));
  }
  return dir;
}

ipcMain.handle('save-board', async (e, dataUrl) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(settings.reportDir, 'Доска.png'),
    filters: [{ name: 'PNG', extensions: ['png'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.mkdirSync(path.dirname(r.filePath), { recursive: true });
  fs.writeFileSync(r.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return r.filePath;
});

// ---------- Доступ из дома: бесплатный туннель Cloudflare (без аккаунта и аренды) ----------
let tunnelProc = null;
let tunnelState = { state: 'off', url: null, error: null };

function setTunnel(patch) {
  tunnelState = { ...tunnelState, ...patch };
  send('tunnel-status', tunnelState);
  if (lessonServer) lessonServer.setPublicUrl(tunnelState.state === 'on' ? tunnelState.url : null);
}

function cloudflaredName() {
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

function findCloudflared() {
  const candidates = [
    path.join(RES, 'bin', cloudflaredName()),
    path.join(app.getPath('userData'), 'bin', cloudflaredName()),
    path.join(path.dirname(app.getPath('exe')), cloudflaredName()),
    path.join(__dirname, '..', cloudflaredName())
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ClassControl' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 6) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.on('data', (c) => {
        got += c.length;
        if (total) setTunnel({ state: 'downloading', progress: Math.round(got / total * 100) });
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(dest); }));
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function ensureCloudflared() {
  const found = findCloudflared();
  if (found) return found;
  const asset = {
    win32: 'cloudflared-windows-amd64.exe',
    linux: process.arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64'
  }[process.platform];
  if (!asset) throw new Error('Скачайте cloudflared вручную и положите рядом с программой');
  const dir = path.join(app.getPath('userData'), 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, cloudflaredName());
  setTunnel({ state: 'downloading', progress: 0, error: null });
  await download(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`, dest);
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  return dest;
}

async function startTunnel() {
  if (tunnelProc || !lessonServer) return;
  setTunnel({ state: 'starting', url: null, error: null });
  let bin;
  try {
    bin = await ensureCloudflared();
  } catch (err) {
    setTunnel({ state: 'error', error: 'Не удалось скачать cloudflared: ' + err.message });
    return;
  }
  tunnelProc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${lessonServer.port}`], { windowsHide: true });
  const onData = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && tunnelState.url !== m[0]) setTunnel({ state: 'on', url: m[0], error: null });
  };
  tunnelProc.stdout.on('data', onData);
  tunnelProc.stderr.on('data', onData);
  tunnelProc.on('exit', (code) => {
    tunnelProc = null;
    if (tunnelState.state !== 'off') setTunnel({ state: 'error', url: null, error: `Туннель остановился (код ${code}). Проверьте интернет.` });
  });
  tunnelProc.on('error', (err) => {
    tunnelProc = null;
    setTunnel({ state: 'error', url: null, error: err.message });
  });
}

function stopTunnel() {
  if (tunnelProc) { try { tunnelProc.kill(); } catch (e) {} }
  tunnelProc = null;
  setTunnel({ state: 'off', url: null, error: null });
}

ipcMain.handle('tunnel', (e, on) => {
  settings.remoteAccess = Boolean(on);
  saveSettings();
  if (on) startTunnel(); else stopTunnel();
  return tunnelState;
});
