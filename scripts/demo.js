#!/usr/bin/env node
'use strict';
/**
 * Пробный запуск ClassControl одной командой — на Windows, macOS и Linux.
 *
 *   npm start            приложение учителя + виртуальный класс (12 ПК и 3 ученика из дома)
 *   npm start -- --agent  ещё и настоящий агент ученика на этом же компьютере
 *   npm start -- --real   без виртуального класса: настоящий урок
 *
 * Сам поставит зависимости при первом запуске. Нужен только Node.js 20+.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const isWin = process.platform === 'win32';
const say = (m) => console.log('\x1b[35m●\x1b[0m ' + m);

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Нужен Node.js 20 или новее (сейчас ${process.versions.node}). Скачайте LTS: https://nodejs.org`);
  process.exit(1);
}

// Зависимости ставим, только если их нет или package.json новее установленных
function ensure(dir, label) {
  const pkg = path.join(root, dir, 'package.json');
  const marker = path.join(root, dir, 'node_modules', '.package-lock.json');
  if (fs.existsSync(marker) && fs.statSync(marker).mtimeMs >= fs.statSync(pkg).mtimeMs) return;
  say(`Ставлю зависимости: ${label}… (один раз, пару минут)`);
  const r = spawnSync(isWin ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: path.join(root, dir), stdio: 'inherit', shell: isWin });
  if (r.status !== 0) { console.error(`Не удалось поставить зависимости (${label}). Проверьте интернет и запустите снова.`); process.exit(1); }
}
ensure('server', 'сервер урока');
ensure('teacher', 'приложение учителя');
if (args.includes('--agent')) ensure('agent', 'агент ученика');

function electronOf(dir) {
  try { return require(path.join(root, dir, 'node_modules', 'electron')); }
  catch (e) { console.error('Electron не установился. Удалите папку node_modules и запустите снова.'); process.exit(1); }
}
// Под root в Linux Chromium требует --no-sandbox; обычным пользователям он не нужен
const extra = process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : [];

function run(dir, env, name) {
  const child = spawn(electronOf(dir), [...extra, path.join(root, dir)], { stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('exit', (code) => { say(`${name} закрыто`); if (dir === 'teacher') process.exit(code || 0); });
  return child;
}

const demo = !args.includes('--real');
say(demo
  ? 'Запускаю ClassControl с виртуальным классом. Страница ученика откроется в браузере после «Начать урок».'
  : 'Запускаю ClassControl для настоящего урока.');
const teacher = run('teacher', demo ? { CLASSCONTROL_DEMO: '1' } : {}, 'Приложение учителя');
if (args.includes('--agent')) {
  say('Запускаю агент ученика на этом же компьютере (он найдёт учителя сам).');
  setTimeout(() => run('agent', { CLASSCONTROL_AGENT_LOCAL: '1' }, 'Агент'), 4000);
}
process.on('SIGINT', () => { teacher.kill(); process.exit(0); });
