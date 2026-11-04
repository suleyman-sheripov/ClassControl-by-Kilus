/* Окно эфира на компьютере ученика: видео учителя и доска поверх. */
(async function () {
  'use strict';
  const api = window.agentAPI;
  const video = document.getElementById('video');
  const wait = document.getElementById('wait');
  const board = new CC.Board(document.getElementById('board-surface'), document.getElementById('board'), { follow: true });
  let viewer = null, socket = null;
  let info = await api.info();

  function setExit(allow) { document.getElementById('exit').classList.toggle('hidden', !allow); }
  setExit(info.broadcast && info.broadcast.allowExit);
  api.onBroadcastState((st) => setExit(st.allowExit));
  document.getElementById('exit').addEventListener('click', () => api.closeDemo());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.closeDemo(); });
  document.getElementById('unmute').addEventListener('click', () => { video.muted = false; video.play(); document.getElementById('unmute').classList.add('hidden'); });

  function showBoard(on) {
    document.getElementById('board-surface').classList.toggle('hidden', !on);
    if (on) { wait.classList.add('hidden'); board.resize(); }
    else if (!video.srcObject) wait.classList.remove('hidden');
  }

  async function start(address) {
    if (!address || socket) return;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = address + '/socket.io/socket.io.js'; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    socket = io(address, { transports: ['websocket'] });
    socket.on('connect', () => socket.emit('register-demo-viewer', { hostname: info.hostname }));
    socket.on('board-state', (b) => {
      board.setStrokes(b.strokes || []);
      board.setView(b.transform);
      showBoard(b.active);
    });
    viewer = CC.ClassViewer({
      socket,
      onStream: (stream) => {
        if (video.srcObject !== stream) video.srcObject = stream;
        wait.classList.add('hidden');
        video.play().catch(() => {
          // Автозапуск со звуком запрещён — показываем без звука и даём кнопку
          video.muted = true; video.play();
          if (stream.getAudioTracks().length) document.getElementById('unmute').classList.remove('hidden');
        });
      },
      onState: (st) => {
        if (st === 'failed' || st === 'disconnected') {
          wait.classList.remove('hidden');
          document.getElementById('wait-text').textContent = 'Связь с учителем прервалась, переподключаюсь…';
        }
      }
    });
    socket.on('whiteboard-mode', showBoard);
    socket.on('draw', (s) => board.add(s));
    socket.on('board-strokes', (l) => board.setStrokes(l));
    socket.on('clear-canvas', () => board.clear());
    socket.on('whiteboard-transform', (t) => board.setView(t));
    socket.on('broadcast-stopped', () => {
      viewer.stop();
      video.srcObject = null;
    });
  }

  if (info.serverAddress) start(info.serverAddress);
  api.onServerAddress(start);
})();
