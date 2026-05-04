# Задача 7: Ученик-Агент — Скриншоты, демонстрация, чат (renderer-файлы)

> **Контекст:** Агент-ядро готово (task-06). Preload API доступен через `window.electronAPI`.
> **Рабочие файлы:** `agent/renderer/index.html`, `agent/renderer/chat.html`, `agent/renderer/demo.html`

## Цель
Создать три HTML-страницы агента: скрытое фоновое окно (скриншоты + управление), чат, демонстрация (fullscreen).

## Файл: `agent/renderer/index.html` (скрытое окно)

Это окно **невидимо** (show: false). Оно выполняет фоновую работу.

```html
<!DOCTYPE html>
<html><head><title>Agent Background</title></head>
<body>
<script src="background.js"></script>
</body></html>
```

## Файл: `agent/renderer/background.js`

```javascript
let socket = null;
let agentName = require('os').hostname(); // Имя ПК как имя агента
// Если os недоступен в renderer — используй electronAPI или хардкод

// Ждём адрес сервера от main process
window.electronAPI.onServerAddress((address) => {
  connectToServer(address);
});

function connectToServer(address) {
  // Подключаем Socket.IO динамически
  const script = document.createElement('script');
  script.src = address + '/socket.io/socket.io.js';
  script.onload = () => {
    socket = io(address);

    socket.on('connect', () => {
      console.log('[AGENT] Подключён:', socket.id);
      socket.emit('register-agent', agentName);
      startScreenshots();
    });

    // Удалённое управление
    socket.on('request-screen-share', () => {
      // Здесь WebRTC: захватить экран, отправить поток учителю
      startScreenShare();
    });

    socket.on('control-command', ({ action, data }) => {
      // Отправить команду в nut-js через IPC
      // window.electronAPI.executeControl(action, data);
    });

    // Демонстрация учителя
    socket.on('broadcast-started', () => {
      window.electronAPI.openDemo();
    });
    socket.on('broadcast-stopped', () => {
      window.electronAPI.closeDemo();
    });
  };
  document.head.appendChild(script);
}

// Скриншоты каждую секунду
function startScreenshots() {
  setInterval(async () => {
    if (!socket || !socket.connected) return;
    const imageBase64 = await window.electronAPI.takeScreenshot();
    if (imageBase64) {
      socket.emit('agent-screenshot', { agentId: socket.id, imageBase64 });
    }
  }, 1000);
}
```

**Примечание:** Для `os.hostname()` в renderer (contextIsolation=true) нужно добавить в preload.js:
```javascript
// Добавь в preload.js в exposeInMainWorld:
hostname: require('os').hostname()
```
И в background.js использовать: `let agentName = window.electronAPI.hostname;`

---

## Файл: `agent/renderer/chat.html`

Полноценное окно чата ученика. Дизайн — тёмная тема, минимальный, как в TZ.md раздел 5.2.

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>ClassControl — Чат</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f1117; color: #e4e4e7;
           height: 100vh; display: flex; flex-direction: column; }
    .header { padding: 12px 16px; background: #1a1d27; border-bottom: 1px solid rgba(255,255,255,0.08);
              font-weight: 600; font-size: 0.95rem; }
    #messages { flex: 1; overflow-y: auto; padding: 12px; }
    .msg { margin-bottom: 10px; font-size: 0.9rem; }
    .msg .author { font-weight: 600; color: #6366f1; }
    .msg.file a { color: #10b981; text-decoration: underline; }
    .input-area { display: flex; gap: 4px; padding: 8px; border-top: 1px solid rgba(255,255,255,0.08); }
    #text-input { flex: 1; background: #252836; border: 1px solid rgba(255,255,255,0.08);
                  color: white; padding: 10px; border-radius: 6px; outline: none; }
    button { background: #6366f1; color: white; border: none; padding: 10px 14px;
             border-radius: 6px; cursor: pointer; }
    button:hover { background: #818cf8; }
    .attach-btn { background: #252836; }
  </style>
</head>
<body>
  <div class="header">💬 Чат класса</div>
  <div id="messages"></div>
  <div class="input-area">
    <button class="attach-btn" id="attachBtn">📎</button>
    <input type="file" id="fileInput" style="display:none">
    <input type="text" id="text-input" placeholder="Сообщение...">
    <button id="sendBtn">→</button>
  </div>

  <script>
    let socket = null;
    const myName = window.electronAPI?.hostname || 'Ученик';

    window.electronAPI.onServerAddress((address) => {
      const s = document.createElement('script');
      s.src = address + '/socket.io/socket.io.js';
      s.onload = () => {
        socket = io(address);
        socket.on('connect', () => socket.emit('register-agent-chat', myName));
        socket.on('chat-message', renderMessage);
        socket.on('chat-file', renderFile);
        socket.on('chat-history', (h) => h.forEach(m => m.type==='file' ? renderFile(m) : renderMessage(m)));
      };
      document.head.appendChild(s);
    });

    document.getElementById('sendBtn').addEventListener('click', send);
    document.getElementById('text-input').addEventListener('keypress', e => { if (e.key==='Enter') send(); });

    function send() {
      const text = document.getElementById('text-input').value.trim();
      if (!text || !socket) return;
      socket.emit('chat-message', { sender: myName, text });
      document.getElementById('text-input').value = '';
    }

    document.getElementById('attachBtn').addEventListener('click', () => document.getElementById('fileInput').click());
    document.getElementById('fileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const fd = new FormData(); fd.append('file', file); fd.append('sender', myName);
      await fetch(socket.io.uri + '/upload', { method: 'POST', body: fd });
      e.target.value = '';
    });

    function renderMessage(m) {
      const d = document.createElement('div'); d.className = 'msg';
      d.innerHTML = `<span class="author">${m.sender}:</span> ${m.text}`;
      document.getElementById('messages').appendChild(d);
      d.scrollIntoView();
    }
    function renderFile(m) {
      const d = document.createElement('div'); d.className = 'msg file';
      d.innerHTML = `<span class="author">${m.sender}:</span> 📎 <a href="${socket.io.uri}${m.url}" target="_blank">${m.filename}</a>`;
      document.getElementById('messages').appendChild(d);
      d.scrollIntoView();
    }
  </script>
</body>
</html>
```

---

## Файл: `agent/renderer/demo.html`

Полноэкранное окно для показа трансляции учителя.

```html
<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <title>Демонстрация</title>
  <style>
    * { margin: 0; } body { background: black; overflow: hidden; }
    video { width: 100vw; height: 100vh; object-fit: contain; }
    canvas { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; }
  </style>
</head>
<body>
  <video id="demoVideo" autoplay playsinline></video>
  <canvas id="demoCanvas"></canvas>
  <script>
    // WebRTC: получить поток от учителя и показать в video
    // Canvas: получать события 'draw' и рисовать поверх
    // Логика подключения будет аналогична online-участнику
  </script>
</body>
</html>
```

## ✅ Проверка завершения
- [ ] Агент при обнаружении сервера начинает слушать скриншоты (видно в лог сервера).
- [ ] В учительском приложении скриншоты появляются в карточках мониторинга.
- [ ] Окно чата: можно написать сообщение, оно видно у учителя и наоборот.
- [ ] Окно чата: можно прикрепить файл.
- [ ] При начале трансляции учителем — агент открывает fullscreen окно.
