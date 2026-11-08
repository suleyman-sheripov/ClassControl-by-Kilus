#!/usr/bin/env node
'use strict';
/**
 * Самая лёгкая проба ClassControl: нужен только Node.js 22.12+ и любой браузер.
 * Никаких программ не устанавливается — окно учителя и страница ученика открываются в браузере,
 * а «класс» из 12 компьютеров и трёх учеников из дома играет виртуальный класс.
 *
 *   npm run demo:web
 *
 * Чего нет в браузерной пробе: записи урока в файл и доступа из дома через туннель —
 * это умеет только приложение учителя (npm start).
 */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const say = (m) => console.log('\x1b[35m●\x1b[0m ' + m);

if (Number(process.versions.node.split('.')[0]) < 22 || (Number(process.versions.node.split('.')[0])===22 && Number(process.versions.node.split('.')[1])<12)) {
  console.error(`Нужен Node.js 22.12 или новее (сейчас ${process.versions.node}): https://nodejs.org`);
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'server', 'node_modules', 'socket.io-client'))) {
  say('Ставлю зависимости сервера урока… (один раз)');
  const r = spawnSync(isWin ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: path.join(root, 'server'), stdio: 'inherit', shell: isWin });
  if (r.status !== 0) process.exit(1);
}

function openBrowser(url) {
  if (process.env.CLASSCONTROL_DEMO_NO_BROWSER) return;
  const cmd = isWin ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch (e) { /* откроют по ссылке */ }
}

// Окно учителя — те же файлы, что в приложении; раздаём их только на этот компьютер
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
function staticServer() {
  const allowed = [path.join(root, 'teacher', 'renderer'), path.join(root, 'shared')];
  return http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.normalize(path.join(root, rel));
    if (!allowed.some(d => file.startsWith(d + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

(async () => {
  const { start } = require(path.join(root, 'server', 'server.js'));
  const token = crypto.randomBytes(12).toString('hex');
  const srv = await start({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'classcontrol-web-')),
    token, roomName: 'Демо-кабинет', log: () => {}
  });
  const { startVirtualClass } = require('./virtual-class.js');
  startVirtualClass({ url: `http://127.0.0.1:${srv.port}`, getCode: () => srv.lessonCode });

  const web = staticServer();
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const teacherUrl = `http://localhost:${web.address().port}/teacher/renderer/index.html?port=${srv.port}&token=${token}`;
  const studentUrl = `http://localhost:${srv.port}/?code=${srv.lessonCode}`;
  console.log('');
  say('ClassControl в браузере готов.');
  console.log(`   Учитель:  ${teacherUrl}`);
  console.log(`   Ученик:   ${studentUrl}   (откройте и на телефоне — по адресу компьютера в сети)`);
  console.log('   Остановить — Ctrl+C');
  openBrowser(teacherUrl);
  setTimeout(() => openBrowser(studentUrl), 2500);
  process.on('SIGINT', async () => { web.close(); await srv.close(); process.exit(0); });
})().catch((e) => { console.error('Не удалось запустить пробу:', e.message); process.exit(1); });
