'use strict';
/**
 * Виртуальный класс для демонстрации: 12 «компьютеров» и трое учеников «из дома».
 * Нужен, чтобы любой мог проверить ClassControl на одном компьютере, без класса и сети.
 *
 * Компьютеры присылают экраны (картинки из demo-screens), иногда переключают программы,
 * представляются именами, блокируются по команде, отвечают на опросы, сдают работы,
 * а один «смотрит YouTube», чтобы сработал «Фокус». Ученики из дома пишут в чат и поднимают руку.
 *
 *   startVirtualClass({ url: 'http://127.0.0.1:3000', getCode: () => server.lessonCode })
 */
const fs = require('fs');
const path = require('path');

const SCREENS_DIR = path.join(__dirname, 'demo-screens');
const PCS = [
  ['ПК-01', 'Иван Петров', 'word'], ['ПК-02', 'Мария Смирнова', 'excel'], ['ПК-03', 'Тимур Ахмедов', 'code'],
  ['ПК-04', 'Алина Ким', 'scratch'], ['ПК-05', 'Даниил Орлов', 'wiki'], ['ПК-06', null, 'desktop'],
  ['ПК-07', 'Софья Белова', 'slides'], ['ПК-08', 'Артём Волков', 'video'], ['ПК-09', 'Полина Морозова', 'paint'],
  ['ПК-10', 'Егор Сидоров', 'code'], ['ПК-11', null, 'word'], ['ПК-12', 'Вероника Козлова', 'scratch']
];
const HOME = [
  ['Лиза Новикова', 'Здравствуйте! Я сегодня из дома, слышу хорошо 👋'],
  ['Кирилл Лебедев', 'А презентацию потом пришлёте?'],
  ['Ева Соколова', null]
];
const TITLES = { word: 'Реферат — Word', excel: 'Оценки — Excel', code: 'main.py — Visual Studio Code', scratch: 'Scratch', wiki: 'Фотосинтез — Википедия', desktop: 'Рабочий стол', slides: 'Солнечная система — PowerPoint', video: 'Топ-10 игр 2026 — YouTube', paint: 'Paint' };

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const later = (a, b, fn) => setTimeout(fn, rnd(a, b));

function loadClient() {
  const candidates = [path.join(__dirname, '..', 'server', 'node_modules', 'socket.io-client'), 'socket.io-client'];
  for (const c of candidates) { try { return require(c).io; } catch (e) { /* следующий */ } }
  throw new Error('Для демо нужен socket.io-client: npm --prefix server install');
}

function startVirtualClass({ url, getCode, log = () => {} }) {
  const io = loadClient();
  const shots = {};
  for (const f of fs.readdirSync(SCREENS_DIR)) if (f.endsWith('.jpg')) shots[f.replace('.jpg', '')] = fs.readFileSync(path.join(SCREENS_DIR, f));
  const sockets = [];
  const timers = [];
  const every = (ms, fn) => timers.push(setInterval(fn, ms));

  // ---------- Компьютеры класса ----------
  PCS.forEach(([pcName, student, app], i) => {
    const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: true });
    sockets.push(s);
    const pc = { app, idle: rnd(0, 20), locked: false, token: null, focus: null, hand: false };
    s.on('connect', () => s.emit('register-agent', { hostname: 'DEMO-PC-' + String(i + 1).padStart(2, '0'), name: pcName, os: 'win32' }));
    s.on('agent-ready', (d) => {
      pc.token = d.uploadToken;
      if (student) later(1500, 7000, () => s.emit('agent-student', { student }, () => {}));
      if (d.focus) pc.focus = d.focus;
    });
    // Новый урок — за компьютерами снова представляются
    s.on('lesson-id', () => { if (student) later(3000, 9000, () => s.emit('agent-student', { student }, () => {})); });
    s.on('screenshot-rate', () => {});
    s.on('control', (c) => {
      if (c.action === 'lock') { pc.locked = true; s.emit('agent-status', { locked: true }); }
      if (c.action === 'unlock') { pc.locked = false; s.emit('agent-status', { locked: false }); }
      if (c.action === 'list-processes') {
        s.emit('agent-processes', { list: [{ pid: 4120 + i, name: app === 'video' ? 'chrome.exe' : 'app.exe', title: TITLES[pc.app] }, { pid: 880, name: 'explorer.exe', title: 'Проводник' }] });
      }
      if (c.action === 'kill') { pc.app = 'desktop'; }
    });
    s.on('focus', (f) => { pc.focus = f; checkFocus(); });
    function checkFocus() {
      const words = (pc.focus && pc.focus.enabled && pc.focus.words) || [];
      const title = TITLES[pc.app] || '';
      const hit = words.find(w => title.toLowerCase().includes(String(w).toLowerCase()));
      s.emit('focus-violation', { title: hit ? title : null });
    }
    // Опрос: отвечают не сразу и по-разному
    s.on('poll', (poll) => later(2000, 12000, () => s.emit('poll-answer', { id: poll.id, option: rnd(0, poll.options.length - 1) })));
    // Сбор работ: сдают файлы с понятными именами
    s.on('collect-request', (c) => {
      if (!student || !pc.token) return;
      later(5000, 25000, async () => {
        try {
          const form = new FormData();
          form.append('file', new Blob([`Работа: ${c.title}\nУченик: ${student}\n`], { type: 'text/plain' }), `${c.title}.txt`);
          await fetch(`${url}/submit?socketId=${encodeURIComponent(s.id)}&token=${encodeURIComponent(pc.token)}&collect=${encodeURIComponent(c.id)}`, { method: 'POST', body: form });
        } catch (e) { log('Демо: не удалось сдать работу', e.message); }
      });
    });
    s.on('hand-lowered', () => { pc.hand = false; });
    // Экран: раз в секунду, но только если «что-то изменилось» — как настоящий агент
    every(1000, () => {
      if (!s.connected) return;
      pc.idle = pc.locked ? pc.idle : (Math.random() < 0.85 ? pc.idle + 1 : 0);
      s.emit('agent-screenshot', { image: shots[pc.app] || shots.desktop, idle: pc.idle });
    });
    // Иногда ученик переключается на другую программу
    every(rnd(25000, 45000), () => {
      if (pc.locked || Math.random() < 0.5) return;
      const apps = Object.keys(shots);
      pc.app = apps[rnd(0, apps.length - 1)];
      pc.idle = 0;
      checkFocus();
    });
    // Тимур поднимает руку через полминуты
    if (i === 2) later(30000, 40000, () => { pc.hand = true; s.emit('raise-hand', true); });
  });

  // ---------- Ученики из дома ----------
  HOME.forEach(([name, text], i) => {
    let s;
    const join = () => {
      s = io(url, { transports: ['websocket'], forceNew: true });
      sockets.push(s);
      s.on('connect', () => s.emit('register-online-user', { name, code: getCode() }));
      s.on('welcome', () => {
        if (text) later(4000 + i * 6000, 9000 + i * 6000, () => s.emit('chat-message', { text }));
        if (i === 2) later(45000, 60000, () => s.emit('raise-hand', true));
      });
      s.on('poll', (poll) => later(3000, 15000, () => s.emit('poll-answer', { id: poll.id, option: rnd(0, poll.options.length - 1) })));
      // Урок закончился — ссылка старая; заходим на следующий урок по новому коду
      s.on('lesson-ended', () => { s.close(); later(6000, 9000, join); });
      s.on('join-error', () => { s.close(); later(5000, 8000, join); });
    };
    later(2500, 6000, join);
  });

  log('Демо: виртуальный класс — 12 компьютеров и 3 ученика из дома');
  return {
    stop() { timers.forEach(clearInterval); sockets.forEach(s => s.close()); }
  };
}

module.exports = { startVirtualClass };
