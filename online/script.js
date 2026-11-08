/* ClassControl — ученик на уроке через браузер (из дома, с ноутбука или телефона). */
(function () {
  'use strict';
  const { $, toast } = CC;
  const socket = io({ transports: ['websocket', 'polling'] });

  const me = { id: null, name: localStorage.getItem('cc-name') || '', joined: false, hand: false, uploadToken: '' };

  // Код урока из ссылки учителя. Без верного кода на урок не попасть — даже если адрес
  // в сети теперь принадлежит компьютеру другого учителя.
  const params = new URLSearchParams(location.search);
  let code = (params.get('code') || sessionStorage.getItem('cc-code') || '').toUpperCase();
  let codeOk = false;
  // Сессия этой вкладки: после обрыва связи ученик возвращается тем же человеком
  let session = sessionStorage.getItem('cc-session');
  if (!session) {
    const a = new Uint8Array(12); crypto.getRandomValues(a);
    session = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('cc-session', session);
  }
  const lesson = { teacherName: 'Учитель', teacherOnline: false, broadcasting: false, board: false };
  let shareLimitMs = 5 * 60 * 1000;

  // ---------- Вход ----------
  $('#name').value = me.name;
  if (!me.name) $('#name').focus();

  function renderJoinLesson() {
    const line = $('#join-lesson');
    const where = [lesson.teacherName, lesson.roomName].filter(Boolean).join(', ');
    line.replaceChildren(
      CC.el('span', { class: 'dot ' + (!socket.connected ? 'dot--warning dot--pulse' : !codeOk ? '' : lesson.teacherOnline ? 'dot--positive' : '') }),
      CC.el('span', { text: !socket.connected ? 'Подключаюсь к классу…'
        : !codeOk ? 'Введите код урока от учителя'
        : lesson.teacherOnline ? `Урок ведёт ${where}` : `${where}: учитель ещё не начал урок, можно войти и подождать` }));
    $('#code-field').classList.toggle('hidden', codeOk);
  }

  function checkCode(c) {
    return new Promise((resolve) => socket.emit('check-code', c, (r) => resolve(r || { ok: false })));
  }
  async function verifyCode() {
    if (!code) { codeOk = false; renderJoinLesson(); return; }
    const r = await checkCode(code);
    codeOk = r.ok;
    if (r.ok) {
      sessionStorage.setItem('cc-code', code);
      const dl = $('#roster');
      dl.replaceChildren(...(r.roster || []).map(n => CC.el('option', { value: n })));
      Object.assign(lesson, { teacherName: r.teacherName, roomName: r.roomName, teacherOnline: r.teacherOnline, broadcasting: r.broadcasting });
    } else {
      $('#code').value = code;
      $('#join-error').textContent = r.error === 'Неверный код урока' ? 'Ссылка устарела или код неверный. Спросите у учителя новую ссылку.' : (r.error || '');
    }
    renderJoinLesson();
  }

  socket.on('connect', () => {
    if (me.joined) socket.emit('register-online-user', { name: me.name, code, session });
    else verifyCode();
    renderJoinLesson();
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
    if (!codeOk) code = ($('#code').value || '').trim().toUpperCase();
    if (!code) { $('#join-error').textContent = 'Введите код урока'; $('#code').focus(); return; }
    if (!name) { $('#join-error').textContent = 'Введите имя'; return; }
    $('#join-error').textContent = '';
    me.name = name;
    localStorage.setItem('cc-name', name);
    $('#join-btn').disabled = true;
    $('#taken').classList.add('hidden');
    socket.emit('register-online-user', { name, code, session });
    setTimeout(() => { $('#join-btn').disabled = false; }, 3000);
  });
  socket.on('join-error', (m) => {
    $('#join-error').textContent = m;
    $('#join-btn').disabled = false;
    if (/код/i.test(m)) { codeOk = false; me.joined = false; renderJoinLesson(); $('#code').focus(); }
  });

  // Этот человек уже на уроке в другом месте: он пересел или это тёзка?
  socket.on('name-taken', ({ name, where }) => {
    $('#join-btn').disabled = false;
    $('#taken-text').textContent = where === 'дома'
      ? `${name} уже на уроке с другого устройства. Это вы? Тогда там урок закроется, а продолжится здесь.`
      : `${name} сейчас на уроке за компьютером «${where}» в классе. Это вы?`;
    $('#taken').classList.remove('hidden');
    $('#taken-yes').focus();
  });
  $('#taken-yes').addEventListener('click', () => {
    $('#taken').classList.add('hidden');
    socket.emit('register-online-user', { name: $('#name').value.trim(), code, session, confirm: true });
  });
  $('#taken-no').addEventListener('click', () => {
    $('#taken').classList.add('hidden');
    $('#join-error').textContent = 'Добавьте фамилию или первую букву фамилии, чтобы учитель вас различал.';
    $('#name').focus();
  });
  // Этот же ученик продолжил урок в другом месте (пересел за компьютер класса или открыл на другом устройстве)
  socket.on('moved', () => {
    leave('Урок продолжается на другом устройстве', 'Вы вошли под этим именем в другом месте, поэтому здесь урок закрыт.');
  });
  // Правила чата от учителя (против спама) и личный запрет писать
  socket.on('lesson-rules', (r) => chat.setRules(r));
  socket.on('chat-muted', (d) => {
    chat.setRules({ muted: d.on });
    CC.toast(d.on ? 'Учитель выключил вам чат до конца урока' : 'Учитель снова разрешил вам писать', { kind: d.on ? 'warning' : 'positive', icon: d.on ? 'mic-off' : 'chat' });
  });
  socket.on('hand-lowered', () => { me.hand = false; renderHand(); });
  // Учитель завершил урок: у следующего урока будет другая ссылка
  socket.on('lesson-ended', () => {
    sessionStorage.removeItem('cc-code');
    leave('Урок закончился', 'Спасибо! Ссылка этого урока больше не работает — на следующий урок учитель пришлёт новую.', true);
  });

  socket.on('welcome', (w) => {
    socket.emit('interactive-sync');
    voiceMode = w.voiceMode || 'permission'; renderMic();
    me.id = w.id;
    chat.opts.meKey = w.key;
    me.name = w.name;
    me.joined = true;
    me.uploadToken = w.uploadToken;
    codeOk = true;
    sessionStorage.setItem('cc-code', code);
    if (w.roomName) lesson.roomName = w.roomName;
    shareLimitMs = w.shareLimitMs || shareLimitMs;
    Object.assign(lesson, { teacherName: w.teacherName, teacherOnline: w.teacherOnline, broadcasting: w.broadcast.active, board: w.board.active });
    chat.opts.meId = w.id;
    chat.setHistory(w.chat || []);
    chat.setRules({ ...(w.rules || {}), muted: Boolean(w.muted) });
    board.setStrokes(w.board.strokes || []);
    board.setView(w.board.transform);
    $('#join').classList.add('hidden');
    $('#gone').classList.add('hidden');
    $('#lesson').classList.remove('hidden');
    $('#me-name').textContent = w.name;
    $('#me-avatar').replaceChildren(CC.avatar(w.name, { sm: true }));
    document.title = `Урок · ${w.teacherName}`;
    renderTeacher();
    renderStage();
    board.resize();
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

  function leave(title, text, final) {
    me.joined = false;
    stopShare(true);
    stopVoice();
    resetMedia();
    socket.disconnect();
    $('#lesson').classList.add('hidden');
    $('#gone-title').textContent = title;
    $('#rejoin').classList.toggle('hidden', Boolean(final));
    // Указка смотрит на кнопку «Вернуться», если вернуться можно; после урока — просто парит
    const gf = $('#gone cc-finger');
    if (gf) { gf.setAttribute('gesture', final ? 'palm' : 'point'); gf.setAttribute('point', final ? 'up' : 'down'); gf.setAttribute('motion', final ? 'wave' : 'nudge'); }
    $('#gone-text').textContent = text;
    $('#gone').classList.remove('hidden');
  }
  socket.on('kicked', (d) => leave('Учитель отключил вас от урока', d && d.ban ? 'До конца этого урока войти под этим именем нельзя.' : 'Если это ошибка — войдите снова.'));

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
  // Ученик не двигает доску сам: видит ровно то, что показывает учитель
  const board = new CC.Board($('#board-surface'), $('#board'), { follow: true });
  window.__board = board;   // для проверок
  let peer = null;
  let gotTrack = false;
  let relayTimer = null;
  let relayOn = false;
  let relayUrl = null;

  function renderStage() {
    const hasVideo = Boolean(video.srcObject) || relayOn;
    $('#board-surface').classList.toggle('hidden', !lesson.board);
    $('#stage').classList.toggle('is-board', lesson.board);
    $('#stage-wrap').classList.toggle('is-board', lesson.board);
    $('#live-chip').classList.toggle('hidden', !(lesson.broadcasting && (hasVideo || lesson.board)));
    const empty = !hasVideo && !lesson.board;
    $('#empty').classList.toggle('hidden', !empty);
    if (empty) {
      $('#empty-title').textContent = !lesson.teacherOnline ? 'Учитель пока не в сети'
        : lesson.broadcasting ? 'Подключаюсь к эфиру…' : 'Учитель ещё не начал показ';
      $('#empty-text').textContent = lesson.broadcasting ? 'Обычно это занимает пару секунд.' : 'Экран учителя или доска появятся здесь автоматически.';
    }
    if (lesson.board) board.resize();
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
  socket.on('whiteboard-transform', (t) => board.setView(t));

  // Во весь экран
  $('#full-btn').addEventListener('click', () => {
    const st = $('#stage');
    if (document.fullscreenElement) document.exitFullscreen();
    else (st.requestFullscreen || st.webkitRequestFullscreen).call(st);
  });
  document.addEventListener('fullscreenchange', () => {
    $('#full-btn use').setAttribute('href', document.fullscreenElement ? '#i-shrink' : '#i-expand');
    setTimeout(() => board.resize(), 50);
  });

  // ---------- Рука ----------
  function renderHand() {
    const b = $('#hand-btn');
    b.classList.toggle('is-on', me.hand);
    b.setAttribute('aria-pressed', me.hand);
    b.querySelector('span').textContent = me.hand ? 'Опустить руку' : 'Поднять руку';
    // Поднятая рука — «указка» вверх подпрыгивает, пока учитель не ответит
    const f = b.querySelector('cc-finger');
    if (f) { if (me.hand) f.setAttribute('motion', 'raise'); else f.removeAttribute('motion'); }
  }
  $('#hand-btn').addEventListener('click', () => {
    me.hand = !me.hand;
    socket.emit('raise-hand', { up: me.hand, question: $('#hand-question').value.trim().slice(0, 200) });
    renderHand();
    if (me.hand) toast('Учитель видит, что вы подняли руку', { kind: 'accent', icon: 'raise' });
  });

  // ---------- Голос (когда учитель дал слово) ----------
  let voice = null, voiceMode = 'permission', voiceGeneration = 0, ptt = false;
  socket.on('voice-mode', mode => { voiceMode = mode; renderMic(); });
  socket.on('voice-granted', async () => {
    if (voice) return;
    const generation = ++voiceGeneration;
    me.hand = false; renderHand();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation !== voiceGeneration) { stream.getTracks().forEach(t => t.stop()); return; }
      const current = voice = { stream, peer: null, muted: false };
      voice.peer = await CC.offerPeer({ socket, target: 'teacher', kind: 'voice', stream, onPeer: p => { if (voice === current) current.peer = p; else p.close(); } });
      renderMic();
      toast('Микрофон включён', { kind: 'positive', icon: 'mic' });
    } catch (e) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (generation === voiceGeneration) { stopVoice(); socket.emit('request-voice', false); }
      toast('Не удалось включить микрофон: разрешите доступ в браузере', { kind: 'warning', icon: 'mic-off' });
    }
  });
  socket.on('voice-revoked', () => { stopVoice(); });
  function stopVoice() {
    voiceGeneration++;
    if (voice?.peer) voice.peer.close();
    if (voice?.stream) voice.stream.getTracks().forEach(t => t.stop());
    voice = null; renderMic();
  }
  function renderMic() {
    const b = $('#mic-btn');
    b.disabled = !voice && voiceMode !== 'free';
    b.classList.toggle('is-mic', Boolean(voice));
    b.querySelector('use').setAttribute('href', voice ? '#i-mic' : '#i-mic-off');
    b.querySelector('span').textContent = voice ? 'Выключить микрофон' : 'Включить микрофон';
    b.title = b.disabled ? 'Учитель включит микрофон, когда даст слово' : '';
    $('#push-to-talk').classList.toggle('hidden', voiceMode !== 'free');
  }
  $('#mic-btn').addEventListener('click', () => {
    if (voice) { stopVoice(); socket.emit('request-voice', false); }
    else if (voiceMode === 'free') socket.emit('request-voice', true);
  });
  function holdVoice(on) {
    if (voiceMode !== 'free' || !me.joined || on === ptt) return;
    ptt = on;
    if (on) socket.emit('request-voice', true);
    else { stopVoice(); socket.emit('request-voice', false); }
  }
  $('#push-to-talk').addEventListener('pointerdown', e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); holdVoice(true); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#push-to-talk').addEventListener(ev, () => holdVoice(false));
  window.addEventListener('blur', () => holdVoice(false));
  document.addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && !e.target.closest('input,textarea,select,[contenteditable=true]') && voiceMode === 'free' && me.joined) { e.preventDefault(); holdVoice(true); } });
  document.addEventListener('keyup', e => { if (e.code === 'Space' && ptt) { e.preventDefault(); holdVoice(false); } });

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
    if (d && d.reason === 'often') return;   // причина уже пришла в чат
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
    onFile: (file, to) => CC.uploadFile('', socket.id, file, to, { token: me.uploadToken })
  });
  socket.on('chat-message', (m) => chat.add(m));
  socket.on('chat-history', (l) => chat.setHistory(l));
  $('#whisper-btn').addEventListener('click', () => {
    chat.setRecipient(chat.to ? null : { id: 'teacher', name: lesson.teacherName });
  });

  // ---------- Опрос и сдача работы ----------
  const tasks = { poll: null, collect: null };
  socket.on('interactive-update',data=>{tasks.interactive=data;renderTasks();});
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
        if (r.ok && tasks.collect) { tasks.collect.submitted = r.filename; renderTasks(); toast('Работа сдана', { kind: 'positive', gesture: 'thumb' }); }
        else if (!r.ok && !r.canceled) toast(r.error || 'Не удалось сдать работу', { kind: 'warning' });
      };
    }
    if (!f) return finishSubmit({ ok: false, canceled: true });
    if (f.size > 50 * 1024 * 1024) return finishSubmit({ ok: false, error: 'Файл больше 50 МБ' });
    const fd = new FormData();
    fd.append('file', f);
    try {
      const res = await fetch(`/submit?socketId=${encodeURIComponent(socket.id)}&token=${encodeURIComponent(me.uploadToken)}&collect=${encodeURIComponent(e.target.dataset.collect)}`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      finishSubmit(res.ok ? { ok: true, filename: data.filename } : { ok: false, error: data.error });
    } catch (err) { finishSubmit({ ok: false, error: 'Нет связи с учителем' }); }
  });
  function renderTasks() {
    const has = Boolean(tasks.poll || tasks.collect || tasks.interactive?.quizzes.length || tasks.interactive?.reviews.length || tasks.interactive?.feedback.length);
    $('#task-panel').classList.toggle('hidden', !has);
    if (!has) return;
    CC.renderStudentTasks($('#task-root'), tasks, {
      onInteractive:(event,data)=>CC.interactiveSend(socket,event,data),
      workUrl:url=>url+'?socketId='+encodeURIComponent(socket.id)+'&token='+encodeURIComponent(me.uploadToken),
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
  // Оформление и экономный режим (для слабых телефонов и компьютеров) — в одном меню
  $('#theme-btn').addEventListener('click', (e) => {
    const dark = document.documentElement.dataset.theme === 'dark';
    const lite = Boolean(document.documentElement.dataset.perf);
    CC.menu(e.currentTarget, [
      { icon: dark ? 'sun' : 'moon', label: dark ? 'Светлая тема' : 'Тёмная тема', run: () => CCTheme.set(dark ? 'light' : 'dark') },
      { icon: lite ? 'check' : 'zap', label: 'Экономный режим', hint: lite ? 'Включён: без размытия и анимаций' : 'Для слабого телефона или компьютера', checked: lite,
        run: () => { CCPerf.set(lite ? 'full' : 'lite'); toast(lite ? 'Экономный режим выключен' : 'Экономный режим включён', { kind: 'positive', icon: 'zap' }); } }
    ], { alignRight: true });
  });

  window.addEventListener('beforeunload', () => { if (shareStream) socket.emit('online-user-stop-share'); });
  renderJoinLesson();
  renderHand();
  renderMic();
})();
