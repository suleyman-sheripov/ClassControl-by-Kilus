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
  const state = { broadcast: { active: false, allowExit: false }, board: false };

  api.onServerAddress((addr) => connect(addr));
  api.info().then((i) => { info = i; if (i.serverAddress) connect(i.serverAddress); });

  function loadClient(addr) {
    return new Promise((resolve, reject) => {
      if (window.io && window.__ioFrom === addr) return resolve();
      const s = document.createElement('script');
      s.src = addr + '/socket.io/socket.io.js';
      s.onload = () => { window.__ioFrom = addr; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
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
    socket = io(addr, { transports: ['websocket'], reconnectionDelayMax: 5000 });

    socket.on('connect', () => {
      socket.emit('register-agent', { hostname: info.hostname, name: info.pcName, os: info.platform });
    });
    socket.on('agent-ready', (d) => {
      api.connectionState({ connected: true, socketId: socket.id, teacherName: d.teacherName });
      state.broadcast = d.broadcast || { active: false };
      api.setFocus(d.focus || { enabled: false, words: [] });
      const act = d.activity || {};
      if (act.poll) api.task({ type: 'poll', poll: act.poll });
      if (act.collection) api.task({ type: 'collect', collection: act.collection });
      syncDemo();
      startShots();
    });
    socket.on('auth-error', (m) => console.warn('[AGENT]', m));
    socket.on('disconnect', () => {
      api.connectionState({ connected: false });
      stopShots();
      stopRemote();
      state.broadcast = { active: false };
      state.board = false;
      syncDemo();
    });

    // Мониторинг
    socket.on('screenshot-rate', ({ active }) => {
      shotInterval = active ? 1000 : 5000;
      stopShots(); startShots();
    });

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
    socket.on('teacher-online', (d) => api.connectionState({ connected: true, socketId: socket.id, teacherName: d.name }));
    socket.on('teacher-disconnected', () => {
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
    socket.on('chat-history', (list) => api.chatEvent({ type: 'history', list }));

    // Задания, опросы, сбор работ, «Фокус»
    socket.on('assignment', (item) => api.assignment({ ...item, url: address + item.url }));
    socket.on('poll', (poll) => api.task({ type: 'poll', poll }));
    socket.on('poll-closed', (poll) => api.task({ type: 'poll-closed', poll }));
    socket.on('collect-request', (collection) => api.task({ type: 'collect', collection }));
    socket.on('collect-closed', (c) => api.task({ type: 'collect-closed', collection: c }));
    socket.on('focus', (f) => api.setFocus(f));
    socket.on('clear-canvas', () => {});
  }

  function syncDemo() {
    api.broadcast({ active: Boolean(state.broadcast.active) || state.board, allowExit: Boolean(state.broadcast.allowExit) && !state.board });
  }

  api.onChatSend((msg) => socket && socket.connected && socket.emit('chat-message', msg));
  api.onChatRequestHistory(() => socket && socket.connected && socket.emit('request-chat-history'));
  api.onProcesses((list) => socket && socket.emit('agent-processes', { list }));
  api.onControlResult((r) => socket && socket.emit('agent-control-result', r));
  api.onAgentStatus((s) => socket && socket.emit('agent-status', s));
  // Окна агента (опрос, «Фокус») отправляют события через это подключение — от имени ПК
  const ALLOWED = new Set(['poll-answer', 'focus-violation']);
  api.onSocketEmit(({ event, data }) => { if (ALLOWED.has(event) && socket && socket.connected) socket.emit(event, data); });

  // ---------- Скриншоты ----------
  function startShots() {
    if (shotTimer) return;
    const tick = async () => {
      if (socket && socket.connected) {
        try {
          const r = await api.takeScreenshot();
          if (r && r.image) socket.emit('agent-screenshot', { image: r.image, idle: r.idle });
        } catch (e) { /* пропускаем кадр */ }
      }
      shotTimer = setTimeout(tick, shotInterval);
    };
    shotTimer = setTimeout(tick, 200);
  }
  function stopShots() { clearTimeout(shotTimer); shotTimer = null; }

  // ---------- Показ экрана учителю (для просмотра и управления) ----------
  async function startRemote() {
    stopRemote();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 20, max: 24 } },
        audio: false
      });
      const track = stream.getVideoTracks()[0];
      if (track) track.contentHint = 'detail';
      remote = { stream, peer: null };
      api.remoteSession(true);
      remote.peer = await CC.offerPeer({
        socket, target: 'teacher', kind: 'remote', stream,
        tune: (pc) => {},
        onState: (st) => { if (st === 'failed' || st === 'closed') stopRemote(); }
      });
      CC.limitBitrate(remote.peer.pc, 6000);
    } catch (err) {
      console.error('[AGENT] Не удалось показать экран', err);
      stopRemote();
    }
  }
  function stopRemote() {
    if (!remote) return;
    if (remote.peer) remote.peer.close();
    if (remote.stream) remote.stream.getTracks().forEach(t => t.stop());
    remote = null;
    api.remoteSession(false);
  }
})();
