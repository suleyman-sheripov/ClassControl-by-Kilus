'use strict';
/**
 * Защита урока от спама: повторы, поток сообщений, медленный режим, «только учителю»,
 * выключенный чат одному ученику, запрет файлов, поднятая-опущенная рука.
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
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-spam-'));
const once = (s, ev, ms = 2500) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout: ' + ev)), ms);
    s.once(ev, (d) => { clearTimeout(t); res(d); });
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function server(opts) {
    const srv = await start({ log: () => {}, dataDir: tmp(), ...opts });
    servers.push(srv);
    srv.url = `http://127.0.0.1:${srv.port}`;
    return srv;
}
function client(srv) { const s = connect(srv.url, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; }
async function teacher(srv) {
    const t = client(srv);
    await once(t, 'connect');
    t.emit('register-teacher', { token: srv.token, name: 'Анна Петровна' });
    t.ready = await once(t, 'teacher-ready');
    return t;
}
async function student(srv, name) {
    const u = client(srv);
    await once(u, 'connect');
    u.emit('register-online-user', { name, code: srv.lessonCode });
    u.welcome = await once(u, 'welcome');
    return u;
}
/** Собирает сообщения чата, пришедшие сокету за время fn */
async function collect(sock, fn, ms = 300) {
    const got = [];
    const h = (m) => got.push(m);
    sock.on('chat-message', h);
    await fn();
    await sleep(ms);
    sock.off('chat-message', h);
    return got;
}

test.after(async () => { sockets.forEach(s => s.close()); for (const s of servers) await s.close(); });

test('повтор одного и того же сообщения и поток сообщений не проходят', async () => {
    const srv = await server({ port: 3950 });
    const t = await teacher(srv);
    const u = await student(srv, 'Петя');
    const seen = await collect(t, async () => {
        for (let i = 0; i < 3; i++) u.emit('chat-message', { text: 'ааааа' });
    });
    assert.equal(seen.filter(m => m.text === 'ааааа').length, 1, 'одинаковое сообщение уходит один раз');
    const mine = await collect(u, async () => {
        for (let i = 0; i < 10; i++) u.emit('chat-message', { text: 'сообщение ' + i });
    });
    const delivered = mine.filter(m => m.type === 'text').length;
    assert.ok(delivered <= 6, 'не больше шести сообщений за 10 секунд: ' + delivered);
    assert.ok(mine.some(m => m.type === 'system' && m.notice && /часто/.test(m.text)), 'ученик видит, почему не отправилось');
    const wall = await collect(t, async () => { u.emit('chat-message', { text: Array(50).fill('строка').join('\n\n\n\n') }); });
    // после потока может сработать ограничение — проверяем только длину, если сообщение дошло
    for (const m of wall.filter(x => x.type === 'text')) assert.ok(m.text.split('\n').length <= 20, 'стена текста обрезана');
});

test('медленный режим и «только учителю»', async () => {
    const srv = await server({ port: 3951 });
    const t = await teacher(srv);
    const u = await student(srv, 'Оля');
    const v = await student(srv, 'Дима');
    const ruled = once(u, 'lesson-rules');
    t.emit('lesson-rules', { chat: 'slow' });
    assert.equal((await ruled).chat, 'slow');
    const slow = await collect(v, async () => {
        u.emit('chat-message', { text: 'первое' });
        await sleep(80);
        u.emit('chat-message', { text: 'второе' });
    });
    assert.ok(slow.some(m => m.text === 'первое'));
    assert.ok(!slow.some(m => m.text === 'второе'), 'второе сообщение в медленном режиме не ушло');
    assert.ok(slow.some(m => m.type === 'system' && /Медленный режим/.test(m.text)), 'все видят, что включён медленный режим');

    t.emit('lesson-rules', { chat: 'teacher' });
    await once(u, 'lesson-rules');
    const toT = once(t, 'chat-message');
    const others = await collect(v, async () => { u.emit('chat-message', { text: 'вопрос учителю' }); });
    const m = await toT;
    assert.equal(m.text, 'вопрос учителю');
    assert.equal(m.to, 'teacher', 'сообщение стало личным учителю');
    assert.ok(!others.some(x => x.text === 'вопрос учителю'), 'одноклассники его не видят');
    // новый ученик сразу знает правила
    const w = await student(srv, 'Саша');
    assert.equal(w.welcome.rules.chat, 'teacher');
});

test('учитель выключает чат одному ученику до конца урока', async () => {
    const srv = await server({ port: 3952 });
    const t = await teacher(srv);
    const u = await student(srv, 'Вова');
    const muted = once(u, 'chat-muted');
    t.emit('mute-chat', { id: u.id, on: true });
    assert.equal((await muted).on, true);
    const seen = await collect(t, async () => { u.emit('chat-message', { text: 'спам' }); });
    assert.ok(!seen.some(m => m.text === 'спам'));
    // переподключение не снимает запрет: запрет у человека, а не у вкладки
    u.close();
    const again = await student(srv, 'Вова');
    assert.equal(again.welcome.muted, true);
    const roster = await once(t, 'roster');
    assert.ok(roster.online.find(x => x.name === 'Вова').muted, 'учитель видит, кому выключен чат');
    // файлы тоже нельзя
    const form = new FormData();
    form.append('socketId', again.id);
    form.append('token', again.welcome.uploadToken);
    form.append('file', new Blob(['hi']), 'note.txt');
    const res = await fetch(srv.url + '/upload', { method: 'POST', body: form });
    assert.equal(res.status, 403);
    // учитель вернул чат
    t.emit('mute-chat', { id: again.id, on: false });
    await once(again, 'chat-muted');
    const ok = await collect(t, async () => { again.emit('chat-message', { text: 'извините' }); });
    assert.ok(ok.some(m => m.text === 'извините'));
});

test('файлы от учеников можно выключить; рука не засыпает учителя уведомлениями', async () => {
    const srv = await server({ port: 3953 });
    const t = await teacher(srv);
    const u = await student(srv, 'Лена');
    t.emit('lesson-rules', { files: false });
    await once(u, 'lesson-rules');
    const form = new FormData();
    form.append('socketId', u.id);
    form.append('token', u.welcome.uploadToken);
    form.append('file', new Blob(['hi']), 'note.txt');
    const res = await fetch(srv.url + '/upload', { method: 'POST', body: form });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /файл/i);

    let hands = 0;
    t.on('hand-raised', () => hands++);
    for (let i = 0; i < 5; i++) { u.emit('raise-hand', true); await sleep(30); u.emit('raise-hand', false); await sleep(30); }
    await sleep(200);
    assert.equal(hands, 1, 'одно уведомление вместо пяти');
});

test('каскад: после пересадки узла его «дети» не теряются и кольца не бывает', async () => {
    // Цепочка учитель → A → B → C (по одному «ребёнку» на узел)
    const srv = await server({ port: 3954, teacherFanout: 1, relayFanout: 1 });
    const t = await teacher(srv);
    const viewers = [];
    async function viewer(host) {
        const d = client(srv);
        await once(d, 'connect');
        d.emit('register-demo-viewer', { hostname: host });
        await once(d, 'board-state');
        d.kids = [];
        d.on('relay-child', c => d.kids.push(c.id));
        d.on('relay-child-gone', c => { d.kids = d.kids.filter(x => x !== c.id); });
        viewers.push(d);
        return d;
    }
    const peers = [];
    t.on('peer-request', r => peers.push(...r.ids));
    const a = await viewer('A');
    t.emit('start-broadcast', {});
    await sleep(150);
    const b = await viewer('B');
    await sleep(150);
    const c = await viewer('C');
    await sleep(200);
    assert.deepEqual([peers.includes(a.id), a.kids, b.kids], [true, [b.id], [c.id]], 'цепочка A → B → C');
    // A выключили: B переходит к учителю, а C остаётся у B
    peers.length = 0;
    a.close();
    await sleep(300);
    assert.ok(peers.includes(b.id), 'B подключается к учителю');
    assert.ok(!peers.includes(c.id), 'C не дёргают — он по-прежнему смотрит через B');
    // Теперь выключили B — C не должен остаться без эфира
    peers.length = 0;
    b.close();
    await sleep(300);
    assert.ok(peers.includes(c.id), 'C переподключился к учителю');
    t.emit('stop-broadcast');
});
