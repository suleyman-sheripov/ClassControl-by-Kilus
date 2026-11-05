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
    const m = await got;
    assert.equal(m.sender, 'Иван Петров');
    assert.equal(m.seat, 'ПК-07', 'место — отдельной пометкой');
});

test('урок одноразовый: после перезапуска прошлый урок не продолжается сам', async () => {
    const dir = tmp();
    const s1 = await start({ port: 3917, dataDir: dir, log: () => {} });
    const t = connect(`http://127.0.0.1:3917`, { transports: ['websocket'], forceNew: true });
    await once(t, 'connect');
    t.emit('register-teacher', { token: s1.token, name: 'Анна Петровна' });
    await once(t, 'teacher-ready');
    for (let i = 0; i < 50; i++) t.emit('draw', { sid: 's' + (i >> 4), x0: i * 10, y0: 10, x1: i * 10 + 8, y1: 20, width: 3, color: '#ff0000', tool: 'pen' });
    t.emit('chat-message', { text: 'было на уроке' });
    await new Promise(r => setTimeout(r, 2200));
    t.close();
    await s1.close();

    // Программу открыли снова: новый урок пустой, а прошлый ждёт решения учителя
    const s2 = await start({ port: 3918, dataDir: dir, log: () => {} });
    assert.equal(s2.getLessonSnapshot().chat.length, 0, 'новый урок пуст');
    const prev = s2.peekPreviousLesson();
    assert.ok(prev && prev.chat.some(m => m.text === 'было на уроке'));
    assert.equal(prev.strokes.length, 50);
    assert.equal(prev.teacherName, 'Анна Петровна');
    // «Продолжить» — урок и доска возвращаются
    s2.resumePrevious();
    assert.equal(s2.getLessonSnapshot().chat.length, 1);
    await s2.close();

    // А «Начать с чистого листа» — прошлое стирается
    const s3 = await start({ port: 3919, dataDir: tmp(), log: () => {} });
    assert.equal(s3.peekPreviousLesson(), null);
    await s3.close();
});

test('ученика пересадили: ответы, работы и личные сообщения идут за ним, а не остаются у ПК', async () => {
    const srv = await server({ port: 3920 });
    const t = await teacher(srv, 'Учитель');
    let activity = t.ready.activity, roster = null;
    t.on('activity', a => { activity = a; });
    t.on('roster', r => { roster = r; });
    const pc = async (host) => {
        const a = client(srv);
        await once(a, 'connect');
        a.emit('register-agent', { hostname: host, name: host });
        a.ready = await once(a, 'agent-ready');
        return a;
    };
    const pc7 = await pc('ПК-07');
    const pc12 = await pc('ПК-12');

    const r1 = await new Promise(r => pc7.emit('agent-student', { student: 'Иван Петров' }, r));
    assert.equal(r1.student, 'Иван Петров');
    t.emit('poll-start', { question: '2+2?', options: ['3', '4'] });
    const poll = await once(pc7, 'poll');
    pc7.emit('poll-answer', { id: poll.id, option: 1 });
    await until(() => activity.polls[0] && activity.polls[0].total === 1);
    t.emit('chat-message', { text: 'Иван, зайди после урока', to: pc7.id });
    await once(pc7, 'chat-message');

    // Учитель отсаживает: Иван садится за ПК-12 и представляется там
    const r2 = await new Promise(r => pc12.emit('agent-student', { student: 'Иван Петров' }, r));
    assert.equal(r2.ok, false);
    assert.equal(r2.where, 'ПК-07', 'система спрашивает: вы пересели с ПК-07?');
    const freed = once(pc7, 'seat-changed');
    const r3 = await new Promise(r => pc12.emit('agent-student', { student: 'Иван Петров', confirm: true }, r));
    assert.equal(r3.ok, true);
    assert.equal((await freed).student, null, 'ПК-07 освободился');
    await until(() => roster && roster.agents.find(a => a.name === 'ПК-12').student === 'Иван Петров' && !roster.agents.find(a => a.name === 'ПК-07').student);

    // Его ответ остался его ответом: переголосовал с ПК-12 — голос всё равно один
    pc12.emit('poll-answer', { id: poll.id, option: 0 });
    await until(() => activity.polls[0].counts[0] === 1);
    assert.equal(activity.polls[0].total, 1);
    // Личное сообщение видно Ивану на новом месте и не видно тому, кто сядет на ПК-07
    const hist12 = await new Promise(r => { pc12.once('chat-history', r); pc12.emit('request-chat-history'); });
    assert.ok(hist12.some(m => m.text === 'Иван, зайди после урока'));
    const hist7 = await new Promise(r => { pc7.once('chat-history', r); pc7.emit('request-chat-history'); });
    assert.ok(!hist7.some(m => m.text === 'Иван, зайди после урока'));
    // Учитель пишет Ивану лично по его старому сообщению — письмо найдёт его на ПК-12
    const got = once(pc12, 'chat-message');
    t.emit('chat-message', { text: 'вижу, пересел', to: 'p:иван петров' });
    assert.equal((await got).text, 'вижу, пересел');

    // Учитель сам сажает Марию за ПК-07
    const seated = once(pc7, 'seat-changed');
    t.emit('seat-assign', { agentId: pc7.id, name: 'Мария Козлова' });
    assert.equal((await seated).student, 'Мария Козлова');


    // Рука у ученика в классе
    const hand = once(t, 'hand-raised');
    pc12.emit('raise-hand', true);
    const h = await hand;
    assert.equal(h.inClass, true);
});

test('ученик пришёл из дома в класс посреди урока — это тот же человек', async () => {
    const srv = await server({ port: 3921 });
    const t = await teacher(srv, 'Учитель');
    const home = client(srv);
    await once(home, 'connect');
    home.emit('register-online-user', { name: 'Саша Белов', code: srv.lessonCode });
    await once(home, 'welcome');
    const pc = client(srv);
    await once(pc, 'connect');
    pc.emit('register-agent', { hostname: 'ПК-03', name: 'ПК-03' });
    await once(pc, 'agent-ready');
    const r = await new Promise(res => pc.emit('agent-student', { student: 'Саша Белов' }, res));
    assert.equal(r.where, 'дома');
    const moved = once(home, 'moved');
    await new Promise(res => pc.emit('agent-student', { student: 'Саша Белов', confirm: true }, res));
    await moved;
});

test('новый урок: места освобождаются, агент не «помнит» вчерашнего ученика', async () => {
    const srv = await server({ port: 3922 });
    const t = await teacher(srv, 'Учитель');
    const pc = client(srv);
    await once(pc, 'connect');
    pc.emit('register-agent', { hostname: 'ПК-01', name: 'ПК-01' });
    const ready = await once(pc, 'agent-ready');
    await new Promise(r => pc.emit('agent-student', { student: 'Иван' }, r));
    // Переподключение в том же уроке — Иван остаётся
    const same = client(srv);
    await once(same, 'connect');
    same.emit('register-agent', { hostname: 'ПК-02', name: 'ПК-02', student: 'Пётр', lessonId: ready.lessonId });
    assert.equal((await once(same, 'agent-ready')).student, 'Пётр');
    // ПК помнит ученика с прошлого урока — не принимаем
    const old = client(srv);
    await once(old, 'connect');
    old.emit('register-agent', { hostname: 'ПК-03', name: 'ПК-03', student: 'Вчерашний', lessonId: 'другой-урок' });
    assert.equal((await once(old, 'agent-ready')).student, null);
    // Учитель завершил урок — все ПК снова свободны
    const freed = once(pc, 'seat-changed');
    t.emit('lesson-reset');
    const f = await freed;
    assert.equal(f.student, null);
    assert.equal(f.reason, 'new-lesson');
});

test('«Не пускать до конца урока» действует до нового урока', async () => {
    const srv = await server({ port: 3923 });
    const t = await teacher(srv, 'Учитель');
    let roster = null;
    t.on('roster', r => { roster = r; });
    const join = async (name) => {
        const u = client(srv);
        await once(u, 'connect');
        u.emit('register-online-user', { name, code: srv.lessonCode });
        return u;
    };
    const u = await join('Хулиган');
    await once(u, 'welcome');
    await until(() => roster && roster.online.length === 1);
    const kicked = once(u, 'kicked');
    t.emit('teacher-kick', { userId: roster.online[0].id, ban: true });
    assert.equal((await kicked).ban, true);
    const again = await join('хулиган');
    assert.match(await once(again, 'join-error'), /закрыл/);
    t.emit('lesson-reset');
    await new Promise(r => setTimeout(r, 100));
    const next = await join('Хулиган');
    await once(next, 'welcome');
});
