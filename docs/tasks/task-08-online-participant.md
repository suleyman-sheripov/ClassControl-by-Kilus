# Задача 8: Онлайн-участник (Веб-интерфейс)

> **Контекст:** Читай `TZ.md` (раздел 6). Сервер готов (task-01), раздаёт статику из `online/`.
> **Рабочие файлы:** `online/index.html`, `online/style.css`, `online/script.js`

## Цель
Создать с нуля веб-интерфейс для онлайн-участника (из дома, через браузер). Минимальный, но красивый: видео/доска + чат + кнопка показать экран с 5-мин таймером.

## Файл: `online/index.html`

Запусти полную перезапись. Два экрана: вход и основной.

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClassControl — Онлайн-участник</title>
  <link rel="stylesheet" href="style.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body>
  <!-- ЭКРАН 1: Вход -->
  <div id="login-screen">
    <div class="login-card">
      <h1>ClassControl</h1>
      <p>Введите имя для подключения к уроку</p>
      <input type="text" id="name-input" placeholder="Ваше имя" maxlength="30">
      <button id="join-btn" class="btn btn-primary">Присоединиться</button>
    </div>
  </div>

  <!-- ЭКРАН 2: Основной -->
  <div id="main-screen" class="hidden">
    <header id="header">
      <span>ClassControl — Онлайн</span>
      <button id="leave-btn" class="btn btn-secondary">Выйти</button>
    </header>
    <main id="layout">
      <!-- Видео / Доска -->
      <section id="media-section">
        <div id="video-area">
          <video id="teacher-video" autoplay playsinline></video>
          <canvas id="teacher-canvas"></canvas>
          <div id="waiting-msg">Ожидание демонстрации учителя...</div>
        </div>
        <div id="share-bar">
          <button id="share-screen-btn" class="btn btn-primary">📺 Показать мой экран (макс. 5 мин)</button>
          <span id="share-timer" class="hidden">05:00</span>
          <button id="stop-share-btn" class="btn btn-danger hidden">Остановить</button>
        </div>
      </section>
      <!-- Чат -->
      <aside id="chat-panel">
        <h3>💬 Чат</h3>
        <div id="chat-messages"></div>
        <div id="chat-input-area">
          <button id="attach-btn">📎</button>
          <input type="file" id="file-input" class="hidden">
          <input type="text" id="msg-input" placeholder="Сообщение...">
          <button id="send-btn">→</button>
        </div>
      </aside>
    </main>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="script.js"></script>
</body>
</html>
```

## Файл: `online/style.css`

Тёмная тема, аналогичная учителю. Ключевые стили:

- `body`: bg `#0f1117`, color `#e4e4e7`, font `Inter`, height 100vh.
- `#login-screen`: flex по центру, высота 100vh.
- `.login-card`: bg `#1a1d27`, padding 40px, border-radius 16px, max-width 400px, text-align center.
- `#layout`: display grid, `grid-template-columns: 1fr 320px`, height calc(100vh - 48px).
- `#video-area`: bg black, position relative, flex 1. `video, canvas`: width 100%, height 100%.
- `#chat-panel`: bg `#1a1d27`, display flex, flex-direction column.
- `#chat-messages`: flex 1, overflow-y auto, padding 12px.
- `#share-bar`: padding 12px, bg `#1a1d27`, display flex, align-items center, gap 12px.
- `#share-timer`: font-size 1.5rem, font-weight 700, color `#ef4444`.
- `.btn-primary`: bg `#6366f1`, `.btn-danger`: bg `#ef4444`.

## Файл: `online/script.js`

```javascript
const socket = io();
let myName = '';
let shareStream = null;
let shareTimerInterval = null;

// ВХОД
document.getElementById('join-btn').addEventListener('click', () => {
  myName = document.getElementById('name-input').value.trim();
  if (!myName) return alert('Введите имя');
  socket.emit('register-online-user', myName);
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
});

// ЧАТ (аналогично teacher, см. task-05)
// sendBtn, attachBtn, renderMessage, renderFile
// socket.on('chat-message'), socket.on('chat-file'), socket.on('chat-history')
// ... (реализуй как в task-05, секция 7)

// ПРИЁМ ДЕМОНСТРАЦИИ УЧИТЕЛЯ
socket.on('broadcast-started', () => {
  document.getElementById('waiting-msg').classList.add('hidden');
  // WebRTC приём потока — ждём offer от учителя
});

socket.on('broadcast-stopped', () => {
  document.getElementById('teacher-video').srcObject = null;
  document.getElementById('waiting-msg').classList.remove('hidden');
});

// WebRTC сигналинг (получение offer от учителя)
socket.on('offer', async ({ source, sdp }) => {
  const pc = new RTCPeerConnection({ iceServers: [{urls:'stun:stun.l.google.com:19302'}] });
  pc.ontrack = (e) => { document.getElementById('teacher-video').srcObject = e.streams[0]; };
  pc.onicecandidate = (e) => { if(e.candidate) socket.emit('ice-candidate',{target:source,candidate:e.candidate}); };
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { target: source, sdp: pc.localDescription });
});

// ДОСКА
socket.on('draw', (data) => { /* рисовать на teacher-canvas */ });
socket.on('clear-canvas', () => { /* очистить teacher-canvas */ });

// ПОКАЗ СВОЕГО ЭКРАНА (5 минут)
document.getElementById('share-screen-btn').addEventListener('click', async () => {
  try {
    shareStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  } catch { return; }

  socket.emit('online-user-share-screen', { userId: socket.id });

  // Показать таймер
  document.getElementById('share-screen-btn').classList.add('hidden');
  document.getElementById('stop-share-btn').classList.remove('hidden');
  document.getElementById('share-timer').classList.remove('hidden');

  let remaining = 300; // 5 минут
  document.getElementById('share-timer').textContent = '05:00';

  shareTimerInterval = setInterval(() => {
    remaining--;
    const min = String(Math.floor(remaining/60)).padStart(2,'0');
    const sec = String(remaining%60).padStart(2,'0');
    document.getElementById('share-timer').textContent = `${min}:${sec}`;
    if (remaining <= 0) stopSharing();
  }, 1000);

  // WebRTC: отправить поток учителю
  // создать peerConnection, addTrack, offer → учитель
});

document.getElementById('stop-share-btn').addEventListener('click', stopSharing);

function stopSharing() {
  if (shareStream) shareStream.getTracks().forEach(t => t.stop());
  shareStream = null;
  clearInterval(shareTimerInterval);
  socket.emit('online-user-stop-share', { userId: socket.id });

  document.getElementById('share-screen-btn').classList.remove('hidden');
  document.getElementById('stop-share-btn').classList.add('hidden');
  document.getElementById('share-timer').classList.add('hidden');
}

// Учитель принудительно закрыл нашу демонстрацию
socket.on('force-stop-sharing', stopSharing);
```

## ✅ Проверка завершения
Открой `http://localhost:3000` в браузере:
- [ ] Экран входа: ввод имени, кнопка «Присоединиться».
- [ ] После входа: видео-зона (с надписью «Ожидание...»), чат справа.
- [ ] Чат: отправка/приём текста и файлов.
- [ ] Кнопка «Показать мой экран» → появляется таймер 05:00, считает вниз.
- [ ] По истечении 5 мин или по кнопке «Остановить» — демонстрация прекращается.
- [ ] При трансляции учителя — видео появляется, надпись «Ожидание» скрывается.
