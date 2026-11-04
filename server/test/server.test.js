'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { start } = require('../server');

let srv, url, dataDir;
const sockets = [];

function client(opts = {}) {
    const s = connect(url, { transports: ['websocket'], forceNew: true, ...opts });
    sockets.push(s);
    return s;
}

function once(socket, event, timeout = 2000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout: ' + event)), timeout);
        socket.once(event, (data) => { clearTimeout(t); resolve(data); });
    });
}

function nothing(socket, event, ms = 300) {
    return new Promise((resolve, reject) => {
        const h = () => reject(new Error('unexpected ' + event));
        socket.once(event, h);
        setTimeout(() => { socket.off(event, h); resolve(); }, ms);
    });
}

async function teacher() {
    const t = client();
    await once(t, 'connect');
    t.emit('register-teacher', { token: srv.token, name: 'Анна Петровна' });
    await once(t, 'teacher-ready');
    return t;
}

async function online(name) {
    const u = client();
    await once(u, 'connect');
    u.emit('register-online-user', { name, code: srv.lessonCode });
    const w = await once(u, 'welcome');
    return { u, w };
}

test.before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
    srv = await start({ port: 3900, dataDir, log: () => {} });
    url = `http://127.0.0.1:${srv.port}`;
});

test.after(async () => {
    sockets.forEach(s => s.close());
    await srv.close();
});

test('учитель без ключа не регистрируется', async () => {
    const t = client();
    await once(t, 'connect');
    t.emit('register-teacher', { token: 'wrong' });
    assert.match(await once(t, 'auth-error'), /ключ/);
});

test('ПК через туннель не может стать агентом', async () => {
    const a = client({ extraHeaders: { 'x-forwarded-for': '8.8.8.8' }, transports: ['polling'] });
    await once(a, 'connect');
    a.emit('register-agent', { hostname: 'fake' });
    await once(a, 'auth-error');
});

test('имя в чате берётся с сервера, а не из сообщения', async () => {
    const t = await teacher();
    const { u } = await online('Миша');
    const got = once(t, 'chat-message');
    u.emit('chat-message', { text: 'привет <b>', sender: 'Учитель' });
    const msg = await got;
    assert.equal(msg.sender, 'Миша');
    assert.equal(msg.role, 'online');
    assert.equal(msg.text, 'привет <b>');
});

test('тёзка: сервер спрашивает «это вы пересели?», а не создаёт второго', async () => {
    const a = await online('Оля');
    const b = client();
    await once(b, 'connect');
    b.emit('register-online-user', { name: 'оля', code: srv.lessonCode });
    const taken = await once(b, 'name-taken');
    assert.equal(taken.name, 'Оля');
    // «Это я, пересела» — прежнее подключение закрывается с пояснением
    const moved = once(a.u, 'moved');
    b.emit('register-online-user', { name: 'Оля', code: srv.lessonCode, confirm: true });
    await once(b, 'welcome');
    await moved;
});

test('личное сообщение видят только двое', async () => {
    const t = await teacher();
    const { u, w } = await online('Петя');
    const { u: other } = await online('Вася');
    const got = once(u, 'chat-message');
    const silent = nothing(other, 'chat-message');
    t.emit('chat-message', { text: 'зайди после урока', to: w.id });
    const msg = await got;
    assert.equal(msg.toKey, w.key);
    await silent;
});

test('ученик не может слать WebRTC-сигналы другому ученику', async () => {
    const t = await teacher();
    const { u } = await online('Катя');
    const { u: victim, w: vw } = await online('Лена');
    const toTeacher = once(t, 'signal');
    const silent = nothing(victim, 'signal');
    u.emit('signal', { target: vw.id, kind: 'share', type: 'offer', payload: { sdp: 'x' } });
    const sig = await toTeacher;
    assert.equal(sig.kind, 'share');
    await silent;
});

test('доска: проверка данных и отмена штриха', async () => {
    const t = await teacher();
    const { u } = await online('Дима');
    const draws = [];
    u.on('draw', d => draws.push(d));
    t.emit('draw', { sid: 'a', x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2, width: 0.002, color: '#ff0000', tool: 'pen' });
    t.emit('draw', { sid: 'b', x0: 'bad', y0: 0, x1: 0, y1: 0, width: 0.002 });
    t.emit('draw', { sid: 'b', x0: 0.3, y0: 0.3, x1: 0.4, y1: 0.4, width: 0.002, color: 'red;}', tool: 'pen' });
    await new Promise(r => setTimeout(r, 200));
    assert.equal(draws.length, 2);
    assert.equal(draws[1].color, '#111111');
    const after = once(u, 'board-strokes');
    t.emit('board-undo');
    const strokes = await after;
    assert.ok(strokes.every(s => s.sid !== 'b'));
    assert.ok(strokes.some(s => s.sid === 'a'));
});

test('ученик не может рисовать и управлять ПК', async () => {
    await teacher();
    const { u } = await online('Хакер');
    const { u: watcher } = await online('Зритель');
    const silent = nothing(watcher, 'draw');
    u.emit('draw', { sid: 'z', x0: 0, y0: 0, x1: 1, y1: 1, width: 0.01 });
    u.emit('agent-control', { agentIds: 'all', action: 'power', data: { mode: 'shutdown' } });
    await silent;
});

test('новый зритель во время эфира получает соединение', async () => {
    const t = await teacher();
    t.emit('start-broadcast', {});
    await once(t, 'peer-request');
    const req = once(t, 'peer-request');
    const { w } = await online('Опоздавший');
    const r = await req;
    assert.deepEqual(r.ids, [w.id]);
    t.emit('stop-broadcast');
});

test('загрузка: SVG запрещён, файл без подключения не принимается', async () => {
    const { w } = await online('Файлов');
    const svg = new FormData();
    svg.append('socketId', w.id);
    svg.append('token', w.uploadToken);
    svg.append('file', new Blob(['<svg onload=alert(1)>']), 'x.svg');
    let res = await fetch(url + '/upload', { method: 'POST', body: svg });
    assert.equal(res.status, 400);

    const anon = new FormData();
    anon.append('socketId', 'nope');
    anon.append('file', new Blob(['hi']), 'a.txt');
    res = await fetch(url + '/upload', { method: 'POST', body: anon });
    assert.equal(res.status, 403);

    const ok = new FormData();
    ok.append('socketId', w.id);
    ok.append('token', w.uploadToken);
    ok.append('file', new Blob(['hi']), 'задание.txt');
    res = await fetch(url + '/upload', { method: 'POST', body: ok });
    assert.equal(res.status, 200);
    const msg = await res.json();
    assert.equal(msg.filename, 'задание.txt');
    // Чужой номер подключения без ключа не помогает
    const forged = new FormData();
    forged.append('socketId', w.id);
    forged.append('file', new Blob(['x']), 'b.txt');
    assert.equal((await fetch(url + '/upload', { method: 'POST', body: forged })).status, 403);
    const file = await fetch(url + msg.url);
    assert.match(file.headers.get('content-disposition'), /attachment/);
});

test('снимок урока содержит посещаемость', async () => {
    const snap = srv.getLessonSnapshot();
    assert.ok(snap.attendance.some(a => a.name === 'Миша'));
});
