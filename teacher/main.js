'use strict';
const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, shell, powerSaveBlocker, nativeTheme } = require('electron');
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
let serverError = null;
let pendingSourceId = null;
let awakeId = null;

// ---------- Настройки ----------
const SETTINGS_PATH = path.join(app.getPath('userData'), 'teacher-settings.json');
const DEFAULTS = {
  roomName: '',
  onboarded: false,
  recordDir: path.join(app.getPath('videos'), 'ClassControl'),
  reportDir: path.join(app.getPath('documents'), 'ClassControl'),
  quality: '1280x720',
  fps: 15,
  allowExit: false,
  shareAudio: true,
  shareMic: false,
  theme: 'auto',
  // Графика этого компьютера: auto — облегчённая на слабом железе
  perf: 'auto',
  // Класс: как часто и насколько чётко ПК присылают экраны, облегчённая графика на ПК учеников
  monInterval: 1000,
  monWidth: 640,
  classLite: false,
  // Запись урока: high | normal | eco
  recQuality: 'normal',
  // Правила чата по умолчанию (против спама): all | slow | teacher; файлы от учеников
  chatMode: 'all',
  studentFiles: true
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
    backgroundColor: (settings.theme === 'dark' || (settings.theme !== 'light' && nativeTheme.shouldUseDarkColors)) ? '#0b0d18' : '#eef0f7',
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
      teacherName: 'Учитель',
      roomName: settings.roomName,
      log: (...a) => console.log('[SERVER]', ...a)
    });
  } catch (err) {
    serverError = err.message;
    console.error('[TEACHER] Сервер не запустился:', err);
  }
  createWindow();
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
  // Урок не был завершён (программу закрыли или был сбой) — учитель решает, что с ним делать
  previous: lessonServer ? summarizePrevious(lessonServer.peekPreviousLesson()) : null
}));

function summarizePrevious(p) {
  if (!p) return null;
  return {
    teacherName: p.teacherName, startedAt: p.lessonStartedAt, endedAt: p.endedAt,
    messages: p.chat.filter(m => m.type !== 'system').length,
    strokes: p.strokes,
    works: p.collections.reduce((n, c) => n + c.submissions.length, 0),
    polls: p.polls.length
  };
}

ipcMain.handle('save-settings', (e, patch) => {
  const allowed = Object.keys(DEFAULTS);
  for (const k of Object.keys(patch || {})) if (allowed.includes(k)) settings[k] = patch[k];
  saveSettings();
  if (lessonServer) lessonServer.setLesson({ roomName: settings.roomName });
  return settings;
});

// ---------- Урок: начало, смена кода, конец ----------
// Имя учителя — только на этот урок: учителя в кабинете меняются
ipcMain.handle('lesson-start', (e, { teacherName } = {}) => {
  if (lessonServer) lessonServer.setLesson({ teacherName: String(teacherName || '').trim() || 'Учитель' });
  return lessonServer ? lessonServer.lessonCode : null;
});

// Новый код посреди урока (если ссылка попала не к тем людям)
ipcMain.handle('new-lesson-code', () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = [...require('crypto').randomBytes(6)].map(b => A[b % A.length]).join('');
  if (lessonServer) lessonServer.setLesson({ lessonCode: code });
  return code;
});

/** Куда сохранить материалы урока — решает учитель (папка, флешка). */
async function askFolder(title) {
  fs.mkdirSync(settings.reportDir, { recursive: true });
  const r = await dialog.showOpenDialog(mainWindow, { title, defaultPath: settings.reportDir, buttonLabel: 'Сохранить сюда', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}

// Конец урока: по желанию сохранить материалы, затем всё стереть
ipcMain.handle('lesson-end', async (e, { save, boardPng } = {}) => {
  if (!lessonServer) return { ok: false };
  let dir = null;
  if (save) {
    const base = await askFolder('Куда сохранить материалы урока');
    if (!base) return { ok: false, canceled: true };
    dir = writeReport(lessonServer.getLessonSnapshot(), boardPng, base);
  }
  lessonServer.endLesson();
  stopTunnel();
  return { ok: true, dir };
});

// Незавершённый урок с прошлого запуска
ipcMain.handle('previous-lesson', async (e, { action, boardPng } = {}) => {
  if (!lessonServer) return { ok: false };
  if (action === 'resume') { lessonServer.resumePrevious(); return { ok: true }; }
  let dir = null;
  if (action === 'save') {
    const base = await askFolder('Куда сохранить материалы прошлого урока');
    if (!base) return { ok: false, canceled: true };
    const prev = lessonServer.peekPreviousLesson();
    if (prev) dir = writeReport(prev, boardPng, base);
  }
  lessonServer.discardPrevious();
  return { ok: true, dir };
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

// Запись пишется во временный файл программы; после остановки учитель сам выбирает, куда её сохранить
let recName = '';
ipcMain.handle('rec-start', (e, { teacherName } = {}) => {
  closeRecording();
  const tmpDir = path.join(app.getPath('userData'), 'recording');
  fs.mkdirSync(tmpDir, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
  recName = `Урок ${stamp}${teacherName ? ' — ' + String(teacherName).replace(/[\\/:*?"<>|]/g, '_') : ''}.webm`;
  recPath = path.join(tmpDir, `rec-${Date.now()}.webm`);
  recStream = fs.createWriteStream(recPath);
  return true;
});

ipcMain.on('rec-chunk', (e, chunk) => {
  if (recStream && chunk) recStream.write(Buffer.from(chunk));
});

ipcMain.handle('rec-stop', async () => {
  const tmp = recPath;
  if (recStream) await new Promise(r => recStream.end(r));
  recStream = null;
  if (!tmp || !fs.existsSync(tmp)) return null;
  // Сохранить как… Если отказаться — спросим, точно ли удалить запись
  for (;;) {
    fs.mkdirSync(settings.recordDir, { recursive: true });
    const r = await dialog.showSaveDialog(mainWindow, { title: 'Сохранить запись урока', defaultPath: path.join(settings.recordDir, recName || 'Урок.webm'), filters: [{ name: 'Видео', extensions: ['webm'] }] });
    if (!r.canceled && r.filePath) {
      try { fs.renameSync(tmp, r.filePath); } catch (err) { fs.copyFileSync(tmp, r.filePath); fs.unlinkSync(tmp); }
      recPath = null;
      return r.filePath;
    }
    const c = await dialog.showMessageBox(mainWindow, { type: 'question', message: 'Удалить запись урока?', detail: 'Запись не сохранена. Её можно сохранить в любую папку или на флешку.', buttons: ['Выбрать, куда сохранить', 'Удалить запись'], defaultId: 0, cancelId: 0, noLink: true });
    if (c.response === 1) { try { fs.unlinkSync(tmp); } catch (err) {} recPath = null; return null; }
  }
});

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


function writeReport(snap, boardPng, baseDir) {
  const d = new Date(snap.lessonStartedAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
  const who = snap.teacherName && snap.teacherName !== 'Учитель' ? ' — ' + String(snap.teacherName).replace(/[\\/:*?"<>|]/g, '_') : '';
  let dir = path.join(baseDir || settings.reportDir, `Урок ${stamp}${who}`);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(baseDir || settings.reportDir, `Урок ${stamp}${who} (${i})`);
  fs.mkdirSync(dir, { recursive: true });


  // Чат
  const lines = snap.chat.map(m => {
    const t = new Date(m.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (m.type === 'system') return `[${t}] — ${m.text}`;
    const priv = m.to ? ` → ${m.toName || 'учителю'} (лично)` : '';
    const body = m.type === 'file' ? `[файл] ${m.filename}` : m.text;
    return `[${t}] ${m.sender}${m.seat ? ` (${m.seat})` : ''}${priv}: ${body}`;
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
  if (on) startTunnel(); else stopTunnel();
  return tunnelState;
});
