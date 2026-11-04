/* ClassControl — ученик на уроке через браузер (из дома, с ноутбука или телефона). */
(function () {
  'use strict';
  const { $, toast } = CC;
  const socket = io({ transports: ['websocket', 'polling'] });

  const me = { id: null, name: localStorage.getItem('cc-name') || '', joined: false, hand: false };
  const lesson = { teacherName: 'Учитель', teacherOnline: false, broadcasting: false, board: false };
  let shareLimitMs = 5 * 60 * 1000;

  // ---------- Вход ----------
  $('#name').value = me.name;
  if (!me.name) $('#name').focus();

  function renderJoinLesson() {
    const line = $('#join-lesson');
    line.replaceChildren(
      CC.el('span', { class: 'dot ' + (!socket.connected ? 'dot--warning dot--pulse' : lesson.teacherOnline ? 'dot--positive' : '') }),
      CC.el('span', { text: !socket.connected ? 'Подключаюсь к классу…'
        : lesson.teacherOnline ? `${lesson.teacherName} ведёт урок` : 'Учитель ещё не начал урок — можно войти и подождать' }));
  }

  socket.on('lesson-info', (info) => {
    Object.assign(lesson, { teacherName: info.teacherName, teacherOnline: info.teacherOnline, broadcasting: info.broadcasting });
    renderJoinLesson();
  });
  socket.on('connect', () => {
    renderJoinLesson();
    if (me.joined) socket.emit('register-online-user', { name: me.name });
  });
  socket.on('disconnect', () => {
    renderJoinLesson();
    if (me.joined) {
      setTeacherLine('Связь потеряна, переподключаюсь…', 'warning');
      resetMedia();
    }
  });

  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#name').value.trim();
    if (!name) { $('#join-error').textContent = 'Введите имя'; return; }
    $('#join-error').textContent = '';
    me.name = name;
    localStorage.setItem('cc-name', name);
    $('#join-btn').disabled = true;
    socket.emit('register-online-user', { name });
    setTimeout(() => { $('#join-btn').disabled = false; }, 3000);
  });
  socket.on('join-error', (m) => { $('#join-error').textContent = m; $('#join-btn').disabled = false; });

  socket.on('welcome', (w) => {
    me.id = w.id;
    me.name = w.name;
    me.joined = true;
    shareLimitMs = w.shareLimitMs || shareLimitMs;
    Object.assign(lesson, { teacherName: w.teacherName, teacherOnline: w.teacherOnline, broadcasting: w.broadcast.active, board: w.board.active });
    chat.opts.meId = w.id;
    chat.setHistory(w.chat || []);
    board.setStrokes(w.board.strokes || []);
    board.setTransform(w.board.transform || {});
    $('#join').classList.add('hidden');
    $('#gone').classList.add('hidden');
    $('#lesson').classList.remove('hidden');
    $('#me-name').textContent = w.name;
    $('#me-avatar').replaceChildren(CC.avatar(w.name, { sm: true }));
    document.title = `Урок · ${w.teacherName}`;
    renderTeacher();
    renderStage();
    board.fit();
    const act = w.activity || {};
    tasks.poll = act.poll || null;
    tasks.collect = act.collection || null;
    renderTasks();
    if (lesson.broadcasting) armRelayFallback();
  });

  $('#leave').addEventListener('click', () => leave('Вы вышли с урока', 'Чтобы вернуться, войдите снова.'));
  $('#rejoin').addEventListener('click', () => {
    $('#gone').classList.add('hidden');
    $('#join').classList.remove('hidden');
    if (!socket.connected) socket.connect();
  });

  function leave(title, text) {
    me.joined = false;
    stopShare(true);
    stopVoice();
    resetMedia();
    socket.disconnect();
    $('#lesson').classList.add('hidden');
    $('#gone-title').textContent = title;
    $('#gone-text').textContent = text;
    $('#gone').classList.remove('hidden');
  }
  socket.on('kicked', () => leave('Учитель отключил вас от урока', 'Если это ошибка — войдите снова или напишите учителю.'));

  // ---------- Учитель ----------
  function setTeacherLine(text, kind) {
    $('#teacher-dot').className = 'dot ' + (kind === 'ok' ? 'dot--positive' : kind === 'warning' ? 'dot--warning dot--pulse' : '');
    $('#teacher-line').textContent = text;
  }
  function renderTeacher() {
    setTeacherLine(lesson.teacherOnline ? `${lesson.teacherName} на связи` : `${lesson.teacherName} пока не в сети`, lesson.teacherOnline ? 'ok' : '');
  }
  socket.on('teacher-online', ({ name }) => { lesson.teacherOnline = true; lesson.teacherName = name; renderTeacher(); renderJoinLesson(); });
  socket.on('teacher-disconnected', () => {
    lesson.teacherOnline = false; lesson.broadcasting = false; lesson.board = false;
    renderTeacher(); renderJoinLesson(); resetMedia(); renderStage();
    if (me.joined) toast('Учитель отключился. Ждём, когда вернётся.', { kind: 'warning' });
  });

  // ---------- Сцена: эфир и доска ----------
  const video = $('#video');
  const board = new CC.Board($('#stage'), $('#board'));
  let peer = null;
  let gotTrack = false;
  let relayTimer = null;
  let relayOn = false;
  let relayUrl = null;

  function renderStage() {
    const hasVideo = Boolean(video.srcObject) || relayOn;
    $('#board').classList.toggle('hidden', !lesson.board);
    $('#live-chip').classList.toggle('hidden', !(lesson.broadcasting && (hasVideo || lesson.board)));
    const empty = !hasVideo && !lesson.board;
    $('#empty').classList.toggle('hidden', !empty);
    if (empty) {
      $('#empty-title').textContent = !lesson.teacherOnline ? 'Учитель пока не в сети'
        : lesson.broadcasting ? 'Подключаюсь к эфиру…' : 'Учитель ещё не начал показ';
      $('#empty-text').textContent = lesson.broadcasting ? 'Обычно это занимает пару секунд.' : 'Экран учителя или доска появятся здесь автоматически.';
    }
    if (lesson.board) board.fit();
  }

  socket.on('broadcast-started', () => {
    lesson.broadcasting = true;
    renderStage();
    toast('Учитель начал эфир', { kind: 'live', icon: 'live' });
    armRelayFallback();
  });
  socket.on('broadcast-stopped', () => {
    lesson.broadcasting = false;
    resetMedia();
    renderStage();
  });

  function resetMedia() {
    if (peer) { peer.close(); peer = null; }
    gotTrack = false;
    video.srcObject = null;
    stopRelay();
    clearTimeout(relayTimer);
    $('#unmute').classList.add('hidden');
  }

  socket.on('signal', async ({ source, kind, type, payload }) => {
    try {
      if (kind === 'broadcast') {
        if (type === 'offer') {
          if (peer) peer.close();
          gotTrack = false;
          peer = CC.answerPeer({
            socket, source, kind: 'broadcast',
            onTrack: (stream) => {
              if (video.srcObject !== stream) video.srcObject = stream;
              gotTrack = true;
              stopRelay();
              video.play().catch(() => {
                video.muted = true;
                video.play().catch(() => {});
                if (stream.getAudioTracks().length) $('#unmute').classList.remove('hidden');
              });
              renderStage();
            },
            onState: (st) => { if (st === 'failed') startRelay(); }
          });
          await peer.offer(payload);
          armRelayFallback();
        } else if (type === 'ice' && peer) {
          await peer.ice(payload);
        }
      } else if (kind === 'share' && sharePeer) {
        if (type === 'answer') await sharePeer.answer(payload);
        if (type === 'ice') await sharePeer.ice(payload);
      } else if (kind === 'voice' && voice && voice.peer) {
        if (type === 'answer') await voice.peer.answer(payload);
        if (type === 'ice') await voice.peer.ice(payload);
      }
    } catch (err) {
      console.error('[ONLINE] signal', kind, type, err);
    }
  });

  $('#unmute').addEventListener('click', () => {
    video.muted = false;
    video.play();
    $('#unmute').classList.add('hidden');
  });

  // Запасной режим: если за 12 секунд видео не пошло — получаем кадры через сервер учителя
  function armRelayFallback() {
    clearTimeout(relayTimer);
    relayTimer = setTimeout(() => {
      if (lesson.broadcasting && !gotTrack && me.joined) startRelay();
    }, 12000);
  }
  function startRelay() {
    if (relayOn) return;
    relayOn = true;
    socket.emit('relay-join');
    $('#relay-chip').classList.remove('hidden');
    renderStage();
  }
  function stopRelay() {
    if (!relayOn) return;
    relayOn = false;
    socket.emit('relay-leave');
    $('#relay').classList.add('hidden');
    $('#relay-chip').classList.add('hidden');
    if (relayUrl) { URL.revokeObjectURL(relayUrl); relayUrl = null; }
    renderStage();
  }
  socket.on('relay-frame', (buf) => {
    if (!relayOn) return;
    const url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
    const img = $('#relay');
    img.onload = () => { if (relayUrl && relayUrl !== url) URL.revokeObjectURL(relayUrl); relayUrl = url; };
    img.src = url;
    img.classList.remove('hidden');
    $('#empty').classList.add('hidden');
  });

  // Доска
  socket.on('whiteboard-mode', (on) => { lesson.board = on; renderStage(); });
  socket.on('draw', (s) => board.add(s));
  socket.on('board-strokes', (l) => board.setStrokes(l));
  socket.on('clear-canvas', () => board.clear());
  socket.on('whiteboard-transform', (t) => board.setTransform(t));

  // Во весь экран
  $('#full-btn').addEventListener('click', () => {
    const st = $('#stage');
    if (document.fullscreenElement) document.exitFullscreen();
    else (st.requestFullscreen || st.webkitRequestFullscreen).call(st);
  });
  document.addEventListener('fullscreenchange', () => {
    $('#full-btn use').setAttribute('href', document.fullscreenElement ? '#i-shrink' : '#i-expand');
    setTimeout(() => board.fit(), 50);
  });

  // ---------- Рука ----------
  function renderHand() {
    const b = $('#hand-btn');
    b.classList.toggle('is-on', me.hand);
    b.setAttribute('aria-pressed', me.hand);
    b.querySelector('span').textContent = me.hand ? 'Опустить руку' : 'Поднять руку';
  }
  $('#hand-btn').addEventListener('click', () => {
    me.hand = !me.hand;
    socket.emit('raise-hand', me.hand);
    renderHand();
    if (me.hand) toast('Учитель видит, что вы подняли руку', { kind: 'accent', icon: 'raise' });
  });

  // ---------- Голос (когда учитель дал слово) ----------
  let voice = null; // { stream, peer, muted }
  socket.on('voice-granted', async () => {
    me.hand = false; renderHand();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      voice = { stream, peer: null, muted: false };
      voice.peer = await CC.offerPeer({ socket, target: 'teacher', kind: 'voice', stream });
      renderMic();
      toast('Учитель дал вам слово — микрофон включён', { kind: 'positive', icon: 'mic' });
    } catch (e) {
      toast('Не удалось включить микрофон: разрешите доступ в браузере', { kind: 'warning', icon: 'mic-off' });
    }
  });
  socket.on('voice-revoked', () => { stopVoice(); toast('Учитель выключил ваш микрофон', { icon: 'mic-off' }); });

  function stopVoice() {
    if (!voice) return;
    if (voice.peer) voice.peer.close();
    voice.stream.getTracks().forEach(t => t.stop());
    voice = null;
    renderMic();
  }
  function renderMic() {
    const b = $('#mic-btn');
    b.disabled = !voice;
    b.classList.toggle('is-mic', Boolean(voice && !voice.muted));
    b.querySelector('use').setAttribute('href', voice && !voice.muted ? '#i-mic' : '#i-mic-off');
    b.querySelector('span').textContent = !voice ? 'Микрофон' : voice.muted ? 'Включить микрофон' : 'Выключить микрофон';
    b.title = voice ? '' : 'Учитель включит микрофон, когда даст слово';
  }
  $('#mic-btn').addEventListener('click', () => {
    if (!voice) return;
    voice.muted = !voice.muted;
    voice.stream.getAudioTracks().forEach(t => { t.enabled = !voice.muted; });
    renderMic();
  });

  // ---------- Показ своего экрана (до 5 минут) ----------
  let shareStream = null;
  let sharePeer = null;
  let shareTimer = null;
  let shareEndsAt = 0;

  $('#share-btn').addEventListener('click', async () => {
    if (shareStream) { stopShare(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      toast('Показ экрана не поддерживается на этом устройстве', { kind: 'warning' });
      return;
    }
    try {
      shareStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
    } catch (e) {
      return; // пользователь передумал
    }
    shareStream.getVideoTracks()[0].onended = () => stopShare();
    socket.emit('online-user-share-screen');
    shareEndsAt = Date.now() + shareLimitMs;
    shareTimer = setInterval(renderShare, 500);
    renderShare();
    toast('Учитель получил запрос и скоро откроет ваш экран', { kind: 'accent', icon: 'share' });
  });

  socket.on('share-accepted', async () => {
    if (!shareStream) return;
    if (sharePeer) sharePeer.close();
    sharePeer = await CC.offerPeer({
      socket, target: 'teacher', kind: 'share', stream: shareStream,
      onState: (st) => { if (st === 'failed') stopShare(); }
    });
    CC.limitBitrate(sharePeer.pc, 2500);
  });
  socket.on('force-stop-sharing', (d) => {
    stopShare(true);
    toast(d && d.reason === 'time' ? 'Пять минут показа закончились' : 'Учитель закрыл показ вашего экрана');
  });

  function stopShare(silent) {
    if (!shareStream) return;
    shareStream.getTracks().forEach(t => t.stop());
    shareStream = null;
    if (sharePeer) { sharePeer.close(); sharePeer = null; }
    clearInterval(shareTimer);
    if (!silent && socket.connected) socket.emit('online-user-stop-share');
    renderShare();
  }
  function renderShare() {
    const b = $('#share-btn');
    const on = Boolean(shareStream);
    b.classList.toggle('is-live', on);
    const label = $('#share-label');
    if (on) {
      const left = Math.max(0, shareEndsAt - Date.now());
      label.textContent = `Остановить · ${CC.duration(left)}`;
      label.classList.add('ctl__timer');
      if (left <= 0) stopShare();
    } else {
      label.textContent = 'Показать экран';
      label.classList.remove('ctl__timer');
    }
    b.querySelector('use').setAttribute('href', on ? '#i-stop' : '#i-share');
  }

  // ---------- Чат ----------
  const chat = new CC.Chat($('#chat'), {
    meId: null,
    emptyText: 'Здесь пишут учитель и весь класс. Кнопка «Учителю» — личное сообщение.',
    onSend: (text, to) => socket.emit('chat-message', { text, to }),
    onFile: (file, to) => CC.uploadFile('', socket.id, file, to)
  });
  socket.on('chat-message', (m) => chat.add(m));
  socket.on('chat-history', (l) => chat.setHistory(l));
  $('#whisper-btn').addEventListener('click', () => {
    chat.setRecipient(chat.to ? null : { id: 'teacher', name: lesson.teacherName });
  });

  // ---------- Опрос и сдача работы ----------
  const tasks = { poll: null, collect: null };
  let submitWaiter = null;
  const finishSubmit = (r) => { const w = submitWaiter; submitWaiter = null; uploading = false; if (w) w(r); };
  let uploading = false;
  // Отмену засчитываем с небольшой задержкой: некоторые браузеры присылают cancel перед change
  $('#submit-file').addEventListener('cancel', () => setTimeout(() => { if (!uploading) finishSubmit({ ok: false, canceled: true }); }, 400));
  $('#submit-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    uploading = true;
    if (!submitWaiter) {
      // Кнопку уже «отпустили» — покажем результат сами
      submitWaiter = (r) => {
        if (r.ok && tasks.collect) { tasks.collect.submitted = r.filename; renderTasks(); toast('Работа сдана', { kind: 'positive' }); }
        else if (!r.ok && !r.canceled) toast(r.error || 'Не удалось сдать работу', { kind: 'warning' });
      };
    }
    if (!f) return finishSubmit({ ok: false, canceled: true });
    if (f.size > 50 * 1024 * 1024) return finishSubmit({ ok: false, error: 'Файл больше 50 МБ' });
    const fd = new FormData();
    fd.append('file', f);
    try {
      const res = await fetch(`/submit?socketId=${encodeURIComponent(socket.id)}&collect=${encodeURIComponent(e.target.dataset.collect)}`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      finishSubmit(res.ok ? { ok: true, filename: data.filename } : { ok: false, error: data.error });
    } catch (err) { finishSubmit({ ok: false, error: 'Нет связи с учителем' }); }
  });
  function renderTasks() {
    const has = Boolean(tasks.poll || tasks.collect);
    $('#task-panel').classList.toggle('hidden', !has);
    if (!has) return;
    CC.renderStudentTasks($('#task-root'), tasks, {
      onAnswer: (id, option) => socket.emit('poll-answer', { id, option }),
      onSubmit: (collectId) => new Promise((resolve) => {
        const input = $('#submit-file');
        if (submitWaiter) submitWaiter({ ok: false, canceled: true });
        submitWaiter = resolve;
        input.dataset.collect = collectId;
        input.value = '';
        input.click();
      })
    });
  }
  socket.on('poll', (p) => {
    tasks.poll = { ...p, open: true };
    renderTasks();
    toast('Учитель задал вопрос', { kind: 'accent', icon: 'poll' });
  });
  socket.on('poll-closed', (p) => {
    if (!tasks.poll || tasks.poll.id !== p.id) return;
    tasks.poll = p.share ? { ...p, open: false, myVote: tasks.poll.myVote } : null;
    renderTasks();
  });
  socket.on('collect-request', (c) => {
    tasks.collect = c;
    renderTasks();
    toast(`Учитель собирает работы: «${c.title}»`, { kind: 'accent', icon: 'inbox' });
  });
  socket.on('collect-closed', (c) => {
    if (tasks.collect && (!c || !c.id || tasks.collect.id === c.id)) { tasks.collect = null; renderTasks(); }
  });

  // ---------- Тема ----------
  function renderThemeBtn() {
    const light = document.documentElement.dataset.theme === 'light';
    $('#theme-btn use').setAttribute('href', light ? '#i-moon' : '#i-sun');
    $('#theme-btn').title = light ? 'Тёмная тема' : 'Светлая тема';
  }
  $('#theme-btn').addEventListener('click', () => {
    const light = document.documentElement.dataset.theme !== 'light';
    if (light) document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('cc-theme', light ? 'light' : 'dark'); } catch (e) {}
    renderThemeBtn();
  });
  renderThemeBtn();

  window.addEventListener('beforeunload', () => { if (shareStream) socket.emit('online-user-stop-share'); });
  renderJoinLesson();
  renderHand();
  renderMic();
})();
