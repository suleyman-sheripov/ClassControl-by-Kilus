/* ClassControl Agent — невидимое окно: связь с учителем, мониторинг, показ экрана, чат. */
(function () {
  'use strict';
  const api = window.agentAPI;
  let socket = null;
  let address = null;
  let shotTimer = null;
  let shotInterval = 1000;
  let remote = null;          // { peer, stream }
  let info = null;
  const state = { broadcast: { active: false, allowExit: false }, board: false, rules: { chat: 'all', files: true, muted: false } };
  function sendRules(r) {
    state.rules = { ...state.rules, ...r };
    api.chatEvent({ type: 'rules', rules: state.rules });
  }

  api.onServerAddress((addr) => connect(addr));
  api.info().then((i) => { info = i; if (i.serverAddress) connect(i.serverAddress); });

  // Клиент Socket.IO лежит внутри программы (shared/ui/vendor): код с найденного в сети «учителя»
  // не загружается и не выполняется — CSP окна тоже запрещает скрипты не из программы
  function loadClient() {
    return window.io ? Promise.resolve() : Promise.reject(new Error('socket.io client missing'));
  }

  async function connect(addr) {
    if (!addr || addr === address) return;
    address = addr;
    if (socket) { socket.close(); socket = null; }
    stopRemote();
    try {
      await loadClient(addr);
    } catch (e) {
      address = null;
      setTimeout(() => api.info().then(i => i.serverAddress && connect(i.serverAddress)), 5000);
      return;
    }
    info = await api.info();
    socket = CC.agentSocket(addr, { transports: ['websocket'], reconnectionDelayMax: 5000 });

    socket.on('connect', () => {
      api.info().then((i) => {
        info = i;
        socket.emit('register-agent', { hostname: i.hostname, name: i.pcName, os: i.platform, room: i.room, student: i.student, lessonId: i.lessonId });
      });
    });
    socket.on('agent-ready', (d) => {
      socket.emit('interactive-sync');
      if (d.prefs) applyPrefs(d.prefs);
      sendRules({ ...(d.rules || {}), muted: Boolean(d.muted) });
      api.connectionState({ connected: true, socketId: socket.id, teacherName: d.teacherName, uploadToken: d.uploadToken, lessonId: d.lessonId });
      api.setRoster(d.roster || []);
      // Сервер мог не принять имя (этот человек уже сидит в другом месте) — место пустое
      if (!d.student) api.seatChanged({ student: null, quiet: true });
      api.teacherBack();
      state.broadcast = d.broadcast || { active: false };
      state.board = Boolean(d.board?.active);
      api.setFocus(d.focus || { enabled: false, words: [] });
      const act = d.activity || {};
      if (act.poll) api.task({ type: 'poll', poll: act.poll });
      if (act.collection) api.task({ type: 'collect', collection: act.collection });
      syncDemo();
      startShots();
    });
    socket.on('auth-error', (m) => {
      console.warn('[AGENT]', m);
      if (m === 'room-mismatch') api.roomMismatch();
    });
    socket.on('released', () => api.released());
    socket.on('bind-room', (d) => api.bindRoom(d));
    socket.on('disconnect', () => {
      api.connectionState({ connected: false });
      stopShots();
      stopRemote();
      state.broadcast = { active: false };
      state.board = false;
      syncDemo();
    });

    // Мониторинг
    socket.on('screenshot-rate', ({ active, interval }) => {
      if (interval) prefs.interval = interval;
      monitoringActive = active;
      shotInterval = active ? prefs.interval : 5000;
      stopShots(); startShots();
    });
    socket.on('class-prefs', applyPrefs);

    // Команды учителя
    socket.on('control', (cmd) => api.control(cmd));
    socket.on('remote-start', startRemote);
    socket.on('remote-stop', stopRemote);
    socket.on('signal', async ({ kind, type, payload }) => {
      if (kind !== 'remote' || !remote || !remote.peer) return;
      try {
        if (type === 'answer') await remote.peer.answer(payload);
        if (type === 'ice') await remote.peer.ice(payload);
      } catch (e) { console.error('[AGENT] signal', e); }
    });

    // Эфир и доска: окно демонстрации на весь экран
    socket.on('broadcast-started', (st) => { state.broadcast = st || { active: true }; syncDemo(); });
    socket.on('broadcast-stopped', () => { state.broadcast = { active: false }; syncDemo(); });
    socket.on('whiteboard-mode', (on) => { state.board = Boolean(on); syncDemo(); });
    socket.on('teacher-online', (d) => { api.connectionState({ connected: true, socketId: socket.id, teacherName: d.name }); api.teacherBack(); });
    socket.on('teacher-disconnected', () => {
      api.teacherGone();
      stopRemote();
      state.broadcast = { active: false }; state.board = false; syncDemo();
      api.notify('ClassControl', 'Учитель отключился');
    });

    // Чат: пересылаем окну беседы
    socket.on('chat-message', (msg) => {
      api.chatEvent({ type: 'message', msg });
      if (msg.senderId !== socket.id && msg.type !== 'system') {
        api.notify(msg.to ? `${msg.sender} — лично вам` : msg.sender, msg.type === 'file' ? 'Файл: ' + msg.filename : msg.text);
      }
    });
    socket.on('chat-history', (list) => { api.chatEvent({ type: 'history', list }); sendRules({}); });
    // Правила чата от учителя (медленный режим, «только учителю», личный запрет) — окну беседы
    socket.on('lesson-rules', (r) => sendRules(r));
    socket.on('chat-muted', (d) => sendRules({ muted: d.on }));

    // Задания, опросы, сбор работ, «Фокус»
    socket.on('interactive-update',data=>api.task({type:'interactive',data}));
    socket.on('assignment', (item) => api.assignment({ ...item, url: address + item.url }));
    socket.on('poll', (poll) => api.task({ type: 'poll', poll }));
    socket.on('poll-closed', (poll) => api.task({ type: 'poll-closed', poll }));
    socket.on('collect-request', (collection) => api.task({ type: 'collect', collection }));
    socket.on('collect-closed', (c) => api.task({ type: 'collect-closed', collection: c }));
    socket.on('focus', (f) => api.setFocus(f));
    socket.on('seat-changed', (d) => {
      socket.emit('interactive-sync');
      if (d && 'muted' in d) sendRules({ muted: d.muted });
      api.seatChanged(d);
      // Другой человек за ПК — его опрос и сбор работ (ответы прежнего ученика ушли вместе с ним)
      const act = d.activity || {};
      api.task({ type: 'reset' });
      if (act.poll) api.task({ type: 'poll', poll: act.poll });
      if (act.collection) api.task({ type: 'collect', collection: act.collection });
    });
    socket.on('hand-lowered', () => api.handLowered());
    socket.on('lesson-id', (d) => api.setLessonId(d.lessonId));
    socket.on('clear-canvas', () => {});
  }

  function syncDemo() {
    api.broadcast({ active: Boolean(state.broadcast.active) || state.board, allowExit: Boolean(state.broadcast.allowExit) && !state.board });
  }

  api.onInteractiveSend(({id,event,data})=>{if(!socket?.connected)return api.interactiveResult({id,result:{ok:false,error:'Нет связи'}});socket.timeout(5000).emit(event,data,(err,result)=>api.interactiveResult({id,result:err?{ok:false,error:'Нет ответа'}:result}));});
  api.onChatSend((msg) => socket && socket.connected && socket.emit('chat-message', msg));
  api.onChatRequestHistory(() => socket && socket.connected && socket.emit('request-chat-history'));
  api.onProcesses((list) => socket && socket.emit('agent-processes', { list }));
  api.onControlResult((r) => socket && socket.emit('agent-control-result', r));
  api.onAgentStatus((s) => socket && socket.emit('agent-status', s));
  // Окна агента (опрос, «Фокус») отправляют события через это подключение — от имени ПК
  const ALLOWED = new Set(['poll-answer', 'focus-violation', 'raise-hand', 'assignment-receipt']);
  api.onIntroduce(({ name, confirm }) => {
    if (!socket || !socket.connected) return api.introduceResult({ ok: false });
    socket.emit('agent-student', { student: name, confirm }, (r) => api.introduceResult(r));
  });
  api.onSocketEmit(({ event, data }) => { if (ALLOWED.has(event) && socket && socket.connected) socket.emit(event, data); });

  // ---------- Скриншоты ----------
  // Один постоянный захват экрана (1 кадр в секунду, 640×360) дешевле, чем каждую секунду
  // просить систему сделать снимок. Неизменившийся экран не отправляем — только «пульс» раз в 5 с.
  const cap = { track: null, grabber: null, canvas: document.createElement('canvas'), probe: document.createElement('canvas'), prev: null, lastSent: 0, failed: false };
  // Настройки класса от учителя: частота и ширина снимков, облегчённая графика окон
  const prefs = { interval: 1000, width: 640, lite: false };
  let monitoringActive = true;
  function applyPrefs(p) {
    const widthChanged = p.width && p.width !== prefs.width;
    Object.assign(prefs, p);
    api.setPerf && api.setPerf(prefs.lite ? 'lite' : 'auto');
    shotInterval = monitoringActive ? prefs.interval : 5000;
    if (widthChanged && cap.track) { cap.track.stop(); cap.track = null; cap.grabber = null; }
    if (shotTimer) { stopShots(); startShots(); }
  }
  cap.canvas.width = 640; cap.canvas.height = 360;
  cap.probe.width = 32; cap.probe.height = 18;

  async function ensureCapture() {
    if (cap.grabber || cap.failed) return Boolean(cap.grabber);
    try {
      const w = prefs.width, h = Math.round(w * 9 / 16);
      const st = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: w, max: w }, height: { ideal: h, max: h }, frameRate: { ideal: 1, max: 2 } }, audio: false });
      cap.track = st.getVideoTracks()[0];
      cap.grabber = new ImageCapture(cap.track);
      cap.track.onended = () => { cap.track = null; cap.grabber = null; };
      return true;
    } catch (e) {
      cap.failed = true;          // запасной путь — снимок через главный процесс
      return false;
    }
  }

  function changed(bmp) {
    const p = cap.probe.getContext('2d', { willReadFrequently: true });
    p.drawImage(bmp, 0, 0, 32, 18);
    const data = p.getImageData(0, 0, 32, 18).data;
    let diff = 0;
    if (cap.prev) for (let k = 0; k < data.length; k += 4) diff += Math.abs(data[k] - cap.prev[k]) + Math.abs(data[k + 1] - cap.prev[k + 1]) + Math.abs(data[k + 2] - cap.prev[k + 2]);
    const isNew = !cap.prev || diff > 600;
    cap.prev = data;
    return isNew;
  }

  async function shot() {
    if (await ensureCapture()) {
      const bmp = await cap.grabber.grabFrame();
      const now = Date.now();
      const isNew = changed(bmp);
      if (!isNew && now - cap.lastSent < 5000) { bmp.close(); return; }
      const ctx = cap.canvas.getContext('2d');
      const scale = Math.min(prefs.width / bmp.width, (prefs.width * 9 / 16) / bmp.height, 1);
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      if (cap.canvas.width !== w || cap.canvas.height !== h) { cap.canvas.width = w; cap.canvas.height = h; }
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const blob = await new Promise(r => cap.canvas.toBlob(r, 'image/jpeg', 0.62));
      const idle = await api.getIdle();
      if (blob && socket && socket.connected) socket.emit('agent-screenshot', { image: await blob.arrayBuffer(), idle });
      cap.lastSent = now;
      return;
    }
    const r = await api.takeScreenshot();
    if (r && r.image && socket && socket.connected) socket.emit('agent-screenshot', { image: r.image, idle: r.idle });
  }

  function startShots() {
    if (shotTimer) return;
    const tick = async () => {
      if (socket && socket.connected) {
        try { await shot(); } catch (e) { /* пропускаем кадр */ }
      }
      shotTimer = setTimeout(tick, shotInterval);
    };
    shotTimer = setTimeout(tick, 200);
  }
  function stopShots() {
    clearTimeout(shotTimer); shotTimer = null;
    // Нет связи с учителем — экран не захватываем вовсе
    if (cap.track) { cap.track.stop(); cap.track = null; cap.grabber = null; }
    cap.prev = null;
  }

  // ---------- Показ экрана учителю (для просмотра и управления) ----------
  let remoteGeneration = 0;
  async function startRemote() {
    stopRemote();
    const generation = remoteGeneration;
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 20, max: 24 } }, audio: false
      });
      if (generation !== remoteGeneration) { stream.getTracks().forEach(t => t.stop()); return; }
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('Захват экрана не вернул видеодорожку');
      track.contentHint = 'detail';
      const session = remote = { stream, peer: null };
      track.onended = () => { if (remote === session) stopRemote(); };
      api.remoteSession(true);
      const peer = await CC.offerPeer({
        socket, target: 'teacher', kind: 'remote', stream,
        onPeer: p => { if (remote === session) session.peer = p; else p.close(); },
        onState: st => { if (remote === session && (st === 'failed' || st === 'closed')) { socket.emit('remote-error', { message: 'Не удалось установить видеосоединение' }); stopRemote(); } }
      });
      if (generation !== remoteGeneration) { peer.close(); return; }
      await CC.limitBitrate(peer.pc, 6000);
    } catch (err) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (generation !== remoteGeneration) return;
      console.error('[AGENT] Не удалось показать экран:', err.name, err.message);
      if (socket?.connected) socket.emit('remote-error', { message: 'Ошибка захвата экрана: ' + (err.message || err.name) });
      stopRemote();
    }
  }
  function stopRemote() {
    remoteGeneration++;
    const old = remote;
    remote = null;
    if (old?.peer) old.peer.close();
    if (old?.stream) old.stream.getTracks().forEach(t => { t.onended = null; t.stop(); });
    api.remoteSession(false);
  }

})();
