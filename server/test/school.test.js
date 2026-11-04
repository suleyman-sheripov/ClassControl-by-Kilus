'use strict';
/**
 * Школа целиком: несколько учителей в одной сети, ученики, которые теряют связь,
 * перезапуск приложения учителя на следующий день.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { start } = require('../server');

const servers = [];
const sockets = [];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-school-'));
const once = (s, ev, ms = 2500) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout: ' + ev)), ms);
    s.once(ev, (d) => { clearTimeout(t); res(d); });
});
const until = async (fn, ms = 2500) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 30)); }
    throw new Error('condition timeout');
};
async function server(opts) {
    const srv = await start({ log: () => {}, dataDir: tmp(), ...opts });
    servers.push(srv);
    srv.url = `http://127.0.0.1:${srv.port}`;
    return srv;
}
function client(srv) { const s = connect(srv.url, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; }
async function teacher(srv, name) {
    const t = client(srv);
    await once(t, 'connect');
    t.emit('register-teacher', { token: srv.token, name });
    t.ready = await once(t, 'teacher-ready');
    return t;
}

test.after(async () => { sockets.forEach(s => s.close()); for (const s of servers) await s.close(); });

test('ученик со ссылкой другого учителя не попадает на чужой урок', async () => {
    const a = await server({ port: 3910, roomName: 'Кабинет 301', teacherName: 'Анна Петровна' });
    const b = await server({ port: 3911, roomName: 'Кабинет 302', teacherName: 'Борис Ильич' });
    assert.notEqual(a.lessonCode, b.lessonCode, 'у учителей разные коды');
    // ссылка учителя А открыта на сервере учителя Б (например, адрес в сети сменился)
    const u = client(b);
    await once(u, 'connect');
    u.emit('register-online-user', { name: 'Петя', code: a.lessonCode });
    assert.match(await once(u, 'join-error'), /код/i);
    // а со своим кодом — видит, чей это урок
    const info = await new Promise(r => u.emit('check-code', b.lessonCode, r));
    assert.equal(info.ok, true);
    assert.equal(info.teacherName, 'Борис Ильич');
    assert.equal(info.roomName, 'Кабинет 302');
    const bad = await new Promise(r => u.emit('check-code', 'AAAAAA', r));
    assert.equal(bad.ok, false);
});

test('ПК, закреплённый за другим кабинетом, не подключается', async () => {
    const srv = await server({ port: 3912, roomName: 'Кабинет 301' });
    const t = await teacher(srv, 'Учитель');
    const a = client(srv);
    await once(a, 'connect');
    a.emit('register-agent', { hostname: 'PC-302-07', room: 'Кабинет 302' });
    assert.equal(await once(a, 'auth-error'), 'room-mismatch');
    const ok = client(srv);
    await once(ok, 'connect');
    ok.emit('register-agent', { hostname: 'PC-301-01', room: '  кабинет  301 ' });
    await once(ok, 'agent-ready');
    // ПК без кабинета подключается, и учитель может закрепить его за собой
    const free = client(srv);
    await once(free, 'connect');
    free.emit('register-agent', { hostname: 'PC-NEW' });
    await once(free, 'agent-ready');
    const bind = once(free, 'bind-room');
    t.emit('bind-room');
    assert.equal((await bind).room, 'Кабинет 301');
});

test('«Это не мой компьютер»: учитель отпускает чужой ПК', async () => {
    const srv = await server({ port: 3913, roomName: 'Кабинет 305' });
    const t = await teacher(srv, 'Учитель');
    let roster = null;
    t.on('roster', r => { roster = r; });
    const a = client(srv);
    await once(a, 'connect');
    a.emit('register-agent', { hostname: 'STRANGER' });
    await once(a, 'agent-ready');
    await until(() => roster && roster.agents.length === 1);
    const released = once(a, 'released');
    t.emit('release-agent', { agentId: roster.agents[0].id });
    await released;
    await until(() => roster.agents.length === 0 && !roster.offline.some(x => x.host === 'STRANGER'));
});

test('ученик потерял связь и вернулся: то же имя, тот же ответ, личные сообщения на месте', async () => {
    const srv = await server({ port: 3914 });
    const t = await teacher(srv, 'Учитель');
    let activity = t.ready.activity;
    t.on('activity', a => { activity = a; });
    const u1 = client(srv);
    await once(u1, 'connect');
    u1.emit('register-online-user', { name: 'Оля', code: srv.lessonCode });
    const w1 = await once(u1, 'welcome');
    t.emit('chat-message', { text: 'лично тебе', to: w1.id });
    await once(u1, 'chat-message');
    t.emit('poll-start', { question: '?', options: ['a', 'b'] });
    const poll = await once(u1, 'poll');
    u1.emit('poll-answer', { id: poll.id, option: 1 });
    await until(() => activity.polls[0] && activity.polls[0].total === 1);

    // связь пропала: новое подключение с той же сессией, старое ещё не закрылось
    const u2 = client(srv);
    await once(u2, 'connect');
    u2.emit('register-online-user', { name: 'Оля', code: srv.lessonCode, session: w1.session });
    const w2 = await once(u2, 'welcome');
    assert.equal(w2.name, 'Оля', 'не превратилась в «Оля 2»');
    assert.ok(w2.chat.some(m => m.text === 'лично тебе'), 'личное сообщение видно после переподключения');
    assert.equal(w2.activity.poll.myVote, 1, 'ответ в опросе сохранился');
    u2.emit('poll-answer', { id: poll.id, option: 0 });
    await until(() => activity.polls[0].counts[0] === 1);
    assert.equal(activity.polls[0].total, 1, 'это всё ещё один голос');
});

test('ключ загрузки: чужой номер подключения не даёт сдать работу за другого', async () => {
    const srv = await server({ port: 3915 });
    const t = await teacher(srv, 'Учитель');
    const victim = client(srv);
    await once(victim, 'connect');
    victim.emit('register-online-user', { name: 'Отличник', code: srv.lessonCode });
    const vw = await once(victim, 'welcome');
    t.emit('collect-start', { title: 'Тест' });
    const c = await once(victim, 'collect-request');
    const fd = new FormData();
    fd.append('file', new Blob(['подмена']), 'плохо.txt');
    const res = await fetch(`${srv.url}/submit?socketId=${vw.id}&token=wrong&collect=${c.id}`, { method: 'POST', body: fd });
    assert.equal(res.status, 403);
    const teach = new FormData();
    teach.append('socketId', t.id);
    teach.append('assign', '1');
    teach.append('file', new Blob(['x']), 'фейк.txt');
    assert.equal((await fetch(srv.url + '/upload', { method: 'POST', body: teach })).status, 403, 'раздать файл от имени учителя нельзя');
});

test('имя ученика за компьютером класса идёт в чат и посещаемость', async () => {
    const srv = await server({ port: 3916 });
    const t = await teacher(srv, 'Учитель');
    const a = client(srv);
    await once(a, 'connect');
    a.emit('register-agent', { hostname: 'PC-07', name: 'ПК-07' });
    await once(a, 'agent-ready');
    a.emit('agent-student', { student: 'Иван Петров' });
    await new Promise(r => setTimeout(r, 100));
    const got = once(t, 'chat-message');
    a.emit('chat-message', { text: 'готово' });
    assert.equal((await got).sender, 'Иван Петров (ПК-07)');
    const snap = srv.getLessonSnapshot();
    assert.ok(snap.attendance.some(x => x.name === 'Иван Петров (ПК-07)'));
});

test('доска переживает перезапуск, а вчерашний урок уходит в отчёт', async () => {
    const dir = tmp();
    const s1 = await start({ port: 3917, dataDir: dir, log: () => {} });
    const t = connect(`http://127.0.0.1:3917`, { transports: ['websocket'], forceNew: true });
    await once(t, 'connect');
    t.emit('register-teacher', { token: s1.token });
    await once(t, 'teacher-ready');
    for (let i = 0; i < 50; i++) t.emit('draw', { sid: 's' + (i >> 4), x0: i / 100, y0: 0.1, x1: i / 100 + 0.01, y1: 0.2, width: 0.003, color: '#ff0000', tool: 'pen' });
    t.emit('chat-message', { text: 'было на уроке' });
    await new Promise(r => setTimeout(r, 2200));
    t.close();
    await s1.close();

    // Через час — тот же урок продолжается
    const s2 = await start({ port: 3918, dataDir: dir, log: () => {} });
    assert.equal(s2.getLessonSnapshot().chat.length, 1);
    const t2 = connect(`http://127.0.0.1:3918`, { transports: ['websocket'], forceNew: true });
    await once(t2, 'connect');
    t2.emit('register-teacher', { token: s2.token });
    const r2 = await once(t2, 'teacher-ready');
    assert.equal(r2.board.strokes.length, 50, 'все штрихи на месте');
    t2.close();
    await s2.close();

    // На следующий день — новый урок, а прошлый отдаётся для отчёта
    const s3 = await start({ port: 3919, dataDir: dir, log: () => {}, staleAfterMs: 1 });
    await new Promise(r => setTimeout(r, 5));
    assert.equal(s3.getLessonSnapshot().chat.length, 0, 'чат нового урока пуст');
    const prev = s3.takePreviousLesson();
    assert.ok(prev && prev.chat.some(m => m.text === 'было на уроке'), 'прошлый урок доступен для отчёта');
    assert.equal(prev.strokes.length, 50);
    await s3.close();
});
