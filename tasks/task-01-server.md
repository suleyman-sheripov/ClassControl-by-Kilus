# Задача 1: Сервер (Ядро системы)

> **Контекст:** Читай `TZ.md` (разделы 2, 7.1–7.5, 7.8). Структура проекта создана в task-00.
> **Рабочий файл:** `server/server.js`

## Цель
Переписать серверную логику с нуля: настройка сервера, загрузка файлов и автоматическое обнаружение. Этот узел будет обслуживать все программы (учитель, агенты, удаленные участники).

## Что создать/изменить

### Файл: `server/server.js`

Полностью перепиши файл. Сервер должен делать следующее:

**1. Express setup:**
- Порт: `3000`.
- Отдача файлов: `express.static('../online')` — раздаёт интерфейс для удаленного участника.
- Статика: `express.static('uploads')` на маршруте `/files`.
- POST `/upload` — принимает файл через `multer`, сохраняет в `uploads/`, возвращает `{ filename, url, size }`.

**2. Socket.IO — Хранение состояния (переменные в памяти):**
```javascript
let teacherSocket = null;      // сокет учителя
let teacherName = '';           // имя учителя
let agents = {};                // { socketId: { id, name, ip } }
let onlineUsers = {};           // { socketId: { id, name } }
let isBroadcasting = false;     // идёт ли демонстрация
let canvasState = null;         // последнее состояние доски (base64 PNG)
let chatHistory = [];           // массив сообщений чата
```

**3. Socket.IO — ВСЕ события, которые сервер должен обрабатывать:**

```
При подключении (connection):
  → Записывать: "[SERVER] Новое подключение: socket.id"

'register-teacher' (roomId, username):
  → Сохранить teacherSocket = socket, teacherName = username
  → Отправить учителю текущий список агентов: socket.emit('agents-list', Object.values(agents))
  → Отправить историю чата: socket.emit('chat-history', chatHistory)

'register-agent' (agentName):
  → Сохранить в agents[socket.id] = { id: socket.id, name: agentName }
  → Если teacherSocket — отправить обновлённый список: teacherSocket.emit('agents-list', ...)

'register-online-user' (username):
  → Сохранить в onlineUsers[socket.id] = { id: socket.id, name: username }
  → Если teacherSocket — отправить: teacherSocket.emit('online-users-list', ...)
  → Отправить этому пользователю: socket.emit('chat-history', chatHistory)
  → Если isBroadcasting — отправить: socket.emit('broadcast-started')
  → Если canvasState — отправить: socket.emit('canvas-state', canvasState)

'agent-screenshot' ({ agentId, imageBase64 }):
  → Пересылать ТОЛЬКО учителю: if (teacherSocket) teacherSocket.emit('agent-screenshot', ...)

'request-agents-list':
  → socket.emit('agents-list', Object.values(agents))

'start-broadcast' (roomId):
  → isBroadcasting = true
  → io.emit('broadcast-started')   // всем

'stop-broadcast' (roomId):
  → isBroadcasting = false
  → io.emit('broadcast-stopped')   // всем

'offer', 'answer', 'ice-candidate' ({ target, sdp/candidate }):
  → Переслать адресату: io.to(target).emit(событие, { source: socket.id, sdp/candidate })

'draw' (data):
  → canvasState = data.image (если есть)
  → socket.broadcast.emit('draw', data)   // всем кроме отправителя

'clear-canvas':
  → canvasState = null
  → socket.broadcast.emit('clear-canvas')

'chat-message' ({ sender, text }):
  → Добавить timestamp: msg = { sender, text, timestamp: Date.now() }
  → chatHistory.push(msg)    // хранить максимум 200 сообщений
  → io.emit('chat-message', msg)

'request-agent-screen' (agentId):
  → io.to(agentId).emit('request-screen-share')

'agent-control' ({ agentId, action, data }):
  → io.to(agentId).emit('control-command', { action, data })

'online-user-share-screen' ({ userId }):
  → if (teacherSocket) teacherSocket.emit('online-user-sharing', { userId, name: onlineUsers[userId]?.name })

'online-user-stop-share' ({ userId }):
  → if (teacherSocket) teacherSocket.emit('online-user-stopped-sharing', { userId })

'teacher-close-share' ({ userId }):
  → io.to(userId).emit('force-stop-sharing')

При отключении (disconnect):
  → Если socket === teacherSocket: teacherSocket = null, isBroadcasting = false
  → Если socket.id в agents: удалить, обновить учителя
  → Если socket.id в onlineUsers: удалить, обновить учителя
```

**4. LAN Discovery (UDP):**
В том же файле, после запуска HTTP-сервера:
```javascript
const dgram = require('dgram');
const os = require('os');

const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (msg, rinfo) => {
  if (msg.toString() === 'CLASSCONTROL_DISCOVER') {
    // Определить свой IP в локальной сети
    const interfaces = os.networkInterfaces();
    let localIP = '127.0.0.1';
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIP = iface.address;
        }
      }
    }
    const response = Buffer.from(`CLASSCONTROL_SERVER:${localIP}:3000`);
    udpServer.send(response, rinfo.port, rinfo.address);
  }
});
udpServer.bind(41234);
```

**5. Multer (загрузка файлов):**
```javascript
const multer = require('multer');
const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

app.post('/upload', upload.single('file'), (req, res) => {
  const fileInfo = {
    filename: req.file.originalname,
    url: `/files/${req.file.filename}`,
    size: req.file.size
  };
  io.emit('chat-file', { sender: req.body.sender || 'Unknown', ...fileInfo, timestamp: Date.now() });
  chatHistory.push({ type: 'file', sender: req.body.sender, ...fileInfo, timestamp: Date.now() });
  res.json(fileInfo);
});
```

## ✅ Проверка завершения
Запусти сервер:
```bash
cd server && node server.js
```
- [ ] Сервер стартует без ошибок на порту 3000.
- [ ] `http://localhost:3000` отдаёт содержимое `online/index.html`.
- [ ] В консоли видно `[SERVER] Listening on port 3000`.
- [ ] UDP-сервер слушает порт 41234 (нет ошибок).
