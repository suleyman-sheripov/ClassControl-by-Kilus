'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { start } = require('../server');

let srv, url;
const sockets = [];
const client = () => { const s = connect(url, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
const once = (s, ev, ms = 2500) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout: ' + ev)), ms);
    s.once(ev, (d) => { clearTimeout(t); res(d); });
});
const until = async (fn, ms = 2500) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 30)); }
    throw new Error('condition timeout');
};

async function teacher() {
    const t = client();
    await once(t, 'connect');
    t.activity = null;
    t.on('activity', a => { t.activity = a; });
    t.emit('register-teacher', { token: srv.token, name: 'Учитель' });
    const ready = await once(t, 'teacher-ready');
    t.activity = ready.activity;
    t.uploadToken = ready.uploadToken;
    return t;
}
async function online(name) {
    const u = client();
    await once(u, 'connect');
    u.emit('register-online-user', { name, code: srv.lessonCode });
    u.welcome = await once(u, 'welcome');
    return u;
}
async function agent(host) {
    const a = client();
    await once(a, 'connect');
    a.emit('register-agent', { hostname: host, name: host });
    a.ready = await once(a, 'agent-ready');
    return a;
}
async function demo(host) {
    const d = client();
    await once(d, 'connect');
    d.emit('register-demo-viewer', { hostname: host });
    await once(d, 'board-state');
    return d;
}

test.before(async () => {
    srv = await start({ port: 3901, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cc-feat-')), log: () => {}, teacherFanout: 1, relayFanout: 2 });
    url = `http://127.0.0.1:${srv.port}`;
});
test.after(async () => { sockets.forEach(s => s.close()); await srv.close(); });

test('опрос: ответы считаются, повторный ответ заменяет прежний, итоги уходят ученикам', async () => {
    const t = await teacher();
    const a = await online('Аня');
    const b = await online('Боря');
    const got = once(a, 'poll');
    t.emit('poll-start', { question: 'Сколько будет 2+2?', options: ['3', '4', '5'] });
    const poll = await got;
    assert.deepEqual(poll.options, ['3', '4', '5']);
    a.emit('poll-answer', { id: poll.id, option: 0 });
    a.emit('poll-answer', { id: poll.id, option: 1 });
    b.emit('poll-answer', { id: poll.id, option: 1 });
    b.emit('poll-answer', { id: poll.id, option: 99 });
    await until(() => t.activity && t.activity.polls[0] && t.activity.polls[0].total === 2 && t.activity.polls[0].counts[1] === 2);
    assert.deepEqual(t.activity.polls[0].counts, [0, 2, 0]);
    const closed = once(b, 'poll-closed');
    t.emit('poll-close', { id: poll.id });
    const res = await closed;
    assert.deepEqual(res.counts, [0, 2, 0]);
    assert.equal(res.voters, undefined, 'ученики не видят, кто как ответил');
});

test('ученик не может начать опрос', async () => {
    const t = await teacher();
    const u = await online('Хитрый');
    const before = t.activity.polls.length;
    u.emit('poll-start', { question: 'x', options: ['a', 'b'] });
    await new Promise(r => setTimeout(r, 200));
    assert.equal(t.activity.polls.length, before);
});

test('сбор работ: файл сохраняется с именем ученика, повторная сдача заменяет', async () => {
    const t = await teacher();
    const u = await online('Петров Иван');
    const req = once(u, 'collect-request');
    t.emit('collect-start', { title: 'Контрольная' });
    const c = await req;
    const send = async (name, body) => {
        const fd = new FormData();
        fd.append('file', new Blob([body]), name);
        return fetch(`${url}/submit?socketId=${u.welcome.id}&token=${u.welcome.uploadToken}&collect=${c.id}`, { method: 'POST', body: fd });
    };
    assert.equal((await send('работа.txt', 'v1')).status, 200);
    assert.equal((await send('работа2.txt', 'v2')).status, 200);
    await until(() => t.activity.collections[0] && t.activity.collections[0].submissions.length === 1 && t.activity.collections[0].submissions[0].filename === 'работа2.txt');
    const col = t.activity.collections[0];
    const files = fs.readdirSync(col.dir);
    assert.deepEqual(files, ['Петров Иван — работа2.txt']);
    t.emit('collect-stop', { id: c.id });
    await until(() => !t.activity.collections[0].open);
    assert.equal((await send('поздно.txt', 'x')).status, 409);
});

test('задание учителя приходит на компьютеры класса', async () => {
    const t = await teacher();
    const a = await agent('PC-ASSIGN');
    const got = once(a, 'assignment');
    const fd = new FormData();
    fd.append('socketId', t.id);
    fd.append('token', t.uploadToken);
    fd.append('assign', '1');
    fd.append('file', new Blob(['задание']), 'Задание 5.pdf');
    const res = await fetch(url + '/upload', { method: 'POST', body: fd });
    assert.equal(res.status, 200);
    const item = await got;
    assert.equal(item.filename, 'Задание 5.pdf');
    const file = await fetch(url + item.url);
    assert.equal(await file.text(), 'задание');
});

test('режим «Фокус»: агент получает слова, учитель — предупреждение', async () => {
    const t = await teacher();
    const a = await agent('PC-FOCUS');
    const cfg = once(a, 'focus');
    t.emit('focus-set', { enabled: true, words: ['YouTube', ' вк '] });
    assert.deepEqual((await cfg).words, ['youtube', 'вк']);
    const alert = once(t, 'focus-alert');
    a.emit('focus-violation', { title: 'Котики — YouTube' });
    const al = await alert;
    assert.equal(al.title, 'Котики — YouTube');
    t.emit('focus-set', { enabled: false, words: [] });
});

test('выключенный ПК остаётся в списке учителя', async () => {
    const t = await teacher();
    let last = null;
    t.on('roster', r => { last = r; });
    const a = await agent('PC-OFFLINE');
    a.close();
    await until(() => last && last.offline.some(x => x.host === 'PC-OFFLINE' && x.lastSeen));
    t.emit('forget-agent', { host: 'PC-OFFLINE' });
    await until(() => last && !last.offline.some(x => x.host === 'PC-OFFLINE'));
});

test('каскад эфира: учитель кормит одного, дальше компьютеры передают друг другу', async () => {
    const t = await teacher();
    const d1 = await demo('D1');
    const d2 = await demo('D2');
    const d3 = await demo('D3');
    const children = { d1: [], d2: [], d3: [] };
    d1.on('relay-child', c => children.d1.push(c.id));
    d2.on('relay-child', c => children.d2.push(c.id));
    d3.on('relay-child', c => children.d3.push(c.id));
    const peers = [];
    t.on('peer-request', r => peers.push(...r.ids));
    t.emit('start-broadcast', {});
    await until(() => peers.length >= 1 && children.d1.length + children.d2.length + children.d3.length === 2);
    const direct = peers.filter(id => [d1.id, d2.id, d3.id].includes(id));
    assert.equal(direct.length, 1, 'учитель передаёт напрямую только одному ПК');

    // Сигнал соседу по каскаду проходит, чужому — уходит учителю
    const parent = [d1, d2, d3].find(d => d.id === direct[0]);
    const child = [d1, d2, d3].find(d => children[['d1', 'd2', 'd3'][[d1, d2, d3].indexOf(parent)]].includes(d.id));
    const got = once(child, 'signal');
    parent.emit('signal', { target: child.id, kind: 'broadcast', type: 'offer', payload: { sdp: 'x' } });
    assert.equal((await got).source, parent.id);

    // Если родитель ушёл — его дети переподключаются
    const again = [];
    t.on('peer-request', r => again.push(...r.ids));
    parent.close();
    await until(() => again.length > 0 || children.d1.length + children.d2.length + children.d3.length > 2);
    t.emit('stop-broadcast');
});
