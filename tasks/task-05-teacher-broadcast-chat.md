# Задача 5: Логика учителя — script.js (Часть 2: Демонстрация + Чат)

> **Контекст:** Мониторинг и доска работают (task-04).
> **Рабочий файл:** `teacher/renderer/script.js` (дописываем)

## Цель
Добавить в script.js демонстрацию экрана (WebRTC трансляция) и общий чат с передачей файлов.

## Секция 6: Демонстрация экрана (Учитель → Все)

**Переменные:**
```javascript
let localStream = null;
let isBroadcasting = false;
const peerConnections = {};
const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let selectedFps = 30;
```

**FPS-переключатель:**
```javascript
document.getElementById('fps30').addEventListener('click', () => {
  selectedFps = 30;
  document.getElementById('fps30').classList.add('active');
  document.getElementById('fps60').classList.remove('active');
});
document.getElementById('fps60').addEventListener('click', () => {
  selectedFps = 60;
  document.getElementById('fps60').classList.add('active');
  document.getElementById('fps30').classList.remove('active');
});
```

**Начать трансляцию — кнопка `#btn-start-broadcast`:**
```
1. Получить qualitySelect.value, разобрать в [width, height].
2. Вызвать navigator.mediaDevices.getDisplayMedia({
     video: { width: {ideal:w, max:w}, height: {ideal:h, max:h}, frameRate: {ideal: selectedFps, max: selectedFps} },
     audio: true
   })
3. Сохранить поток в localStream.
4. Показать превью: document.getElementById('preview-video').srcObject = localStream.
5. Скрыть кнопку «Начать», показать «Остановить».
6. isBroadcasting = true
7. socket.emit('start-broadcast', 'main')
8. Скрыть #preview-placeholder.
```

**Остановить трансляцию — кнопка `#btn-stop-broadcast`:**
```
1. localStream.getTracks().forEach(t => t.stop()), localStream = null.
2. preview-video.srcObject = null.
3. Показать кнопку «Начать», скрыть «Остановить».
4. isBroadcasting = false.
5. socket.emit('stop-broadcast', 'main').
6. Закрыть все peerConnections: for (id in peerConnections) { pc.close(); delete peerConnections[id]; }
7. Показать #preview-placeholder.
```

**WebRTC сигналинг (учитель создаёт offer для каждого подкл. пользователя):**
```
socket.on('initiate-peer-connections', (users)) =>
  Для каждого user: создать RTCPeerConnection, добавить localStream треки,
  создать offer, setLocalDescription, socket.emit('offer', {target: user.id, sdp}).
  pc.onicecandidate → socket.emit('ice-candidate', {target, candidate}).

socket.on('answer', ({source, sdp})) =>
  peerConnections[source].setRemoteDescription(sdp).

socket.on('ice-candidate', ({source, candidate})) =>
  peerConnections[source].addIceCandidate(candidate).
```

**ВАЖНО:** На сервере (task-01) при `start-broadcast` нужно добавить логику: собрать всех подключённых студентов/агентов/онлайн-участников и отправить учителю `'initiate-peer-connections'` со списком ID. Если этого ещё нет — добавь в `server/server.js`.

## Секция 7: Чат

**Отправка текстового сообщения:**
```javascript
const chatInput = document.getElementById('chat-text-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatMessages = document.getElementById('chat-messages');

chatSendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', { sender: teacherName, text });
  chatInput.value = '';
}
```

**Отправка файла:**
```javascript
document.getElementById('chat-attach-btn').addEventListener('click', () => {
  document.getElementById('chat-file-input').click();
});

document.getElementById('chat-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('sender', teacherName);
  const res = await fetch('http://localhost:3000/upload', { method: 'POST', body: formData });
  const data = await res.json();
  // Сервер сам рассылает chat-file всем через socket
  e.target.value = ''; // сбросить input
});
```

**Получение сообщений:**
```javascript
socket.on('chat-message', (msg) => renderChatMessage(msg));
socket.on('chat-file', (msg) => renderChatFile(msg));
socket.on('chat-history', (history) => {
  chatMessages.innerHTML = '';
  history.forEach(m => m.type === 'file' ? renderChatFile(m) : renderChatMessage(m));
});

function renderChatMessage(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="sender">${msg.sender}:</span> ${msg.text}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderChatFile(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg chat-file';
  const sizeMB = (msg.size / 1024 / 1024).toFixed(1);
  div.innerHTML = `<span class="sender">${msg.sender}:</span> 📎 <a href="http://localhost:3000${msg.url}" target="_blank" download="${msg.filename}">${msg.filename}</a> (${sizeMB} MB)`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
```

## Секция 8: Онлайн-участники (левая панель)

```javascript
socket.on('online-users-list', (users) => {
  const list = document.getElementById('online-users-list');
  document.getElementById('online-count').textContent = users.length;
  document.getElementById('online-status-count').textContent = users.length;
  list.innerHTML = '';
  users.forEach(u => {
    const li = document.createElement('li');
    li.className = 'online-user';
    li.innerHTML = `<span class="user-avatar">👤</span> ${u.name}`;
    list.appendChild(li);
  });
});
```

**Приём демонстрации экрана от онлайн-участника:**
```javascript
socket.on('online-user-sharing', ({ userId, name }) => {
  document.getElementById('online-demo-modal').classList.remove('hidden');
  document.getElementById('online-demo-title').innerText = `Демонстрация: ${name}`;
  // WebRTC: принять поток от userId
});

document.getElementById('online-demo-close').addEventListener('click', () => {
  document.getElementById('online-demo-modal').classList.add('hidden');
  socket.emit('teacher-close-share', { userId: currentDemoUserId });
});
```

## ✅ Проверка завершения
- [ ] Кнопка «Начать эфир» запрашивает выбор экрана, показывает превью в правой панели.
- [ ] Кнопка «Остановить» останавливает трансляцию.
- [ ] Чат: можно писать текст и видеть свои + чужие сообщения.
- [ ] Чат: можно прикрепить файл, он загружается, появляется ссылка на скачивание.
- [ ] Список онлайн-участников обновляется при подключении/отключении.
