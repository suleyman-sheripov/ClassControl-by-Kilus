'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  vm = require('node:vm');
const { io } = require('socket.io-client');
const { start } = require('../server');
const { verify, fingerprint } = require('../../shared/teacher-identity');
const wait = (s, event) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error(event + ' timed out')), 2000);
    s.once(event, (...args) => {
      clearTimeout(t);
      resolve(args);
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-feedback-'));
  const server = await start({ port: 0, dataDir: dir, log: () => {} });
  const clients = [];
  t.after(async () => {
    clients.forEach((s) => s.close());
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = 'http://127.0.0.1:' + server.port;
  async function client(role, data = {}, nonce = 'test-nonce') {
    const s = io(url, {
      transports: ['websocket'],
      forceNew: true,
      auth: { nonce }
    });
    clients.push(s);
    await wait(s, 'connect');
    const ready = wait(
      s,
      role === 'teacher'
        ? 'teacher-ready'
        : role === 'agent'
          ? 'agent-ready'
          : 'welcome'
    );
    s.emit('register-' + (role === 'online' ? 'online-user' : role), {
      token: server.token,
      name: 'Test ' + role,
      hostname: 'PC',
      code: server.lessonCode,
      ...data
    });
    s.ready = (await ready)[0];
    return s;
  }
  return { server, url, client };
}
test('FPS increases the bitrate budget without changing clarity preference', () => {
  const sandbox = {
    window: {},
    document: { readyState: 'loading', addEventListener() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../../shared/ui/common.js'), 'utf8'),
    sandbox
  );
  const budget = sandbox.window.CC.videoBudget;
  const b10 = budget({ width: 1280, height: 720, fps: 10 }),
    b30 = budget({ width: 1280, height: 720, fps: 30 });
  assert.ok(b30 >= b10 * 2.9);
  assert.ok(budget({ width: 1920, height: 1080, fps: 30 }) > b30);
  assert.ok(budget({ width: 3840, height: 2160, fps: 60, viewers: 8 }) <= 5000);
});
test('commands require the paired teacher and current connection nonce', async (t) => {
  const { url, client } = await setup(t);
  const teacher = await client('teacher');
  const agent = await client('agent', {}, 'fresh-session');
  const identity = await (await fetch(url + '/api/identity')).json();
  assert.equal(identity.fingerprint, fingerprint(identity.publicKey));
  const response = wait(agent, 'control');
  teacher.emit('agent-control', {
    agentIds: [agent.id],
    action: 'lock',
    data: { text: 'Attention' }
  });
  const [command, proof] = await response;
  assert.ok(
    verify(identity.publicKey, 'control', [command], proof, 'fresh-session')
  );
  assert.ok(
    !verify(
      identity.publicKey,
      'control',
      [{ action: 'power', data: { mode: 'shutdown' } }],
      proof,
      'fresh-session'
    )
  );
  assert.ok(
    !verify(identity.publicKey, 'control', [command], proof, 'old-session')
  );
});
test('microphones: permission by default, teacher can enable free mode and mute all', async (t) => {
  const { client } = await setup(t);
  const teacher = await client('teacher');
  const user = await client('online');
  let grants = 0;
  user.on('voice-granted', () => grants++);
  user.emit('request-voice', true);
  await sleep(80);
  assert.equal(grants, 0);
  const mode = wait(user, 'voice-mode');
  teacher.emit('set-voice-mode', 'free');
  assert.equal((await mode)[0], 'free');
  const granted = wait(user, 'voice-granted');
  user.emit('request-voice', true);
  await granted;
  const revoked = wait(user, 'voice-revoked');
  teacher.emit('teacher-voice', { userId: 'all', on: false });
  await revoked;
});
test('hands retain order, questions and outcome; history is reset with lesson', async (t) => {
  const { client } = await setup(t);
  const teacher = await client('teacher');
  const user = await client('online', { name: 'Иван' });
  const history = wait(teacher, 'hand-history');
  user.emit('raise-hand', { up: true, question: 'Почему небо синее?' });
  const [h] = await history;
  assert.equal(h[0].question, 'Почему небо синее?');
  assert.equal(h[0].action, 'raised');
  const lowered = wait(user, 'hand-lowered');
  teacher.emit('lower-hand', { id: user.id, answered: true });
  await lowered;
  const reset = wait(teacher, 'hand-history');
  teacher.emit('lesson-reset');
  assert.deepEqual((await reset)[0], []);
});
const rpc = (socket, event, data) =>
  new Promise((resolve, reject) =>
    socket
      .timeout(2000)
      .emit(event, data, (err, result) => (err ? reject(err) : resolve(result)))
  );
test('quiz keeps correct answers private, first answer final and results teacher-only', async (t) => {
  const { client } = await setup(t),
    teacher = await client('teacher'),
    user = await client('online', { name: 'Иван' }),
    other = await client('online', { name: 'Мария' });
  const quiz = {
    title: 'Арифметика',
    questions: [
      { text: '2+2', options: ['4', '5'], correct: 0 },
      { text: '3+3', options: ['6', '7'], correct: 0 }
    ]
  };
  assert.equal((await rpc(user, 'quiz-create', quiz)).ok, false);
  const incoming = wait(user, 'interactive-update');
  const created = await rpc(teacher, 'quiz-create', quiz);
  assert.ok(created.ok);
  const [before] = await incoming;
  assert.equal(before.quizzes[0].questions[0].correct, undefined);
  assert.equal(before.quizzes[0].results, undefined);
  const result = await rpc(user, 'quiz-answer', {
    id: created.id,
    index: 0,
    option: 1
  });
  assert.equal(result.correct, 0);
  assert.equal(result.answer, 1);
  assert.equal(
    (await rpc(user, 'quiz-answer', { id: created.id, index: 0, option: 0 }))
      .answer,
    1
  );
  const second = wait(other, 'interactive-update');
  other.emit('interactive-sync');
  const [view] = await second;
  assert.equal(view.quizzes[0].questions[0].correct, undefined);
  assert.equal(view.quizzes[0].results, undefined);
  teacher.emit('quiz-close', { id: created.id });
  await sleep(30);
  assert.equal(
    (await rpc(user, 'quiz-answer', { id: created.id, index: 1, option: 0 }))
      .ok,
    false
  );
});
test('anonymous peer review assigns another person, protects files and accepts review/feedback', async (t) => {
  const { url, client } = await setup(t),
    teacher = await client('teacher'),
    a = await client('online', { name: 'Иван' }),
    b = await client('online', { name: 'Мария' });
  const request = wait(a, 'collect-request');
  teacher.emit('collect-start', { title: 'Работы' });
  const [collection] = await request;
  async function upload(socket, text) {
    const form = new FormData();
    form.append('file', new Blob([text]), 'работа.txt');
    const res = await fetch(
      url +
        `/submit?socketId=${socket.id}&token=${socket.ready.uploadToken}&collect=${collection.id}`,
      { method: 'POST', body: form }
    );
    assert.equal(res.status, 200);
  }
  await upload(a, 'work-a');
  await upload(b, 'work-b');
  const incoming = wait(a, 'interactive-update');
  const created = await rpc(teacher, 'review-create', {
    collectionId: collection.id
  });
  assert.ok(created.ok);
  const [state] = await incoming,
    review = state.reviews[0];
  assert.equal(review.author, undefined);
  assert.equal(review.reviewer, undefined);
  assert.equal(review.assignments, undefined);
  const address =
    url + review.url + `?socketId=${a.id}&token=${a.ready.uploadToken}`;
  const file = await fetch(address);
  assert.equal(file.status, 200);
  assert.equal(await file.text(), 'work-b');
  assert.equal(
    (
      await fetch(
        url + review.url + `?socketId=${b.id}&token=${b.ready.uploadToken}`
      )
    ).status,
    404
  );
  assert.ok(
    (
      await rpc(a, 'review-answer', {
        id: created.id,
        score: 4,
        comment: 'Хорошо'
      })
    ).ok
  );
  assert.ok(
    (
      await rpc(teacher, 'work-feedback', {
        collectionId: collection.id,
        name: 'Иван',
        text: 'Продолжайте'
      })
    ).ok
  );
  const feedback = wait(a, 'interactive-update');
  a.emit('interactive-sync');
  assert.equal((await feedback)[0].feedback[0].text, 'Продолжайте');
});
test('board geometry preserves text, moves objects and undo restores previous coordinates', async (t) => {
  const { client } = await setup(t),
    teacher = await client('teacher'),
    user = await client('online');
  let incoming = wait(user, 'draw');
  teacher.emit('draw', {
    sid: 'rect',
    tool: 'rectangle',
    width: 4,
    color: '#112233',
    x0: 0,
    y0: 0,
    x1: 50,
    y1: 50
  });
  assert.equal((await incoming)[0].tool, 'rectangle');
  incoming = wait(user, 'board-strokes');
  teacher.emit('board-edit', { sid: 'rect', x0: 10, y0: 10, x1: 60, y1: 60 });
  assert.equal((await incoming)[0][0].x0, 10);
  incoming = wait(user, 'board-strokes');
  teacher.emit('board-undo');
  assert.equal((await incoming)[0][0].x0, 0);
  incoming = wait(user, 'draw');
  teacher.emit('draw', {
    sid: 'text',
    tool: 'text',
    width: 6,
    color: '#112233',
    x0: 0,
    y0: 0,
    x1: 400,
    y1: 50,
    text: 'Пример'
  });
  assert.equal((await incoming)[0].text, 'Пример');
});

test('board events synchronize to thirty classroom clients', async (t) => {
  const { client } = await setup(t),
    teacher = await client('teacher'),
    agents = [];
  for (let i = 0; i < 30; i++)
    agents.push(
      await client(
        'agent',
        { hostname: 'PC-' + i, name: 'PC-' + i },
        'nonce-' + i
      )
    );
  const received = agents.map((agent) => wait(agent, 'draw'));
  teacher.emit('draw', {
    sid: 'classroom',
    tool: 'arrow',
    width: 4,
    color: '#112233',
    x0: 0,
    y0: 0,
    x1: 100,
    y1: 100
  });
  const copies = await Promise.all(received);
  assert.equal(copies.length, 30);
  copies.forEach(([stroke, proof], i) => {
    assert.equal(stroke.sid, 'classroom');
    assert.equal(proof.nonce, 'nonce-' + i);
  });
});

test('malformed quiz inputs are rejected without crashing the lesson', async (t) => {
  const { client } = await setup(t),
    teacher = await client('teacher'),
    user = await client('online');
  user.emit('quiz-create', {}, 'not-a-callback');
  await sleep(30);
  assert.equal((await rpc(teacher, 'quiz-create', null)).ok, false);
  assert.equal(
    (await rpc(teacher, 'quiz-create', { questions: [null] })).ok,
    false
  );
  const q = await rpc(teacher, 'quiz-create', {
    questions: [{ text: 'Question', options: ['A', 'B'], correct: 0 }]
  });
  for (const index of ['__proto__', -1, 1, {}, null])
    assert.equal(
      (await rpc(user, 'quiz-answer', { id: q.id, index, option: 0 })).ok,
      false
    );
  assert.equal((await rpc(user, 'quiz-answer', null)).ok, false);
  assert.equal(
    (await rpc(user, 'quiz-answer', { id: q.id, index: 0, option: 0 })).ok,
    true
  );
});
