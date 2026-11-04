# Задача 4: Логика учителя — script.js (Часть 1: Мониторинг + Табы + Доска)

> **Контекст:** HTML/CSS готовы (task-03). Сервер работает (task-01). Все ID элементов — в `teacher/renderer/index.html`.
> **Рабочий файл:** `teacher/renderer/script.js`

## Цель
Реализовать основную клиентскую логику учителя: подключение к серверу, мониторинг ПК с живыми скриншотами, переключение табов, онлайн-доску (кисть + ластик).

## Файл: `teacher/renderer/script.js`

### Секция 1: Подключение к серверу

```javascript
const socket = io('http://localhost:3000');
const teacherName = 'Учитель'; // Потом можно сделать настраиваемым

socket.on('connect', () => {
  console.log('[TEACHER] Подключён к серверу:', socket.id);
  socket.emit('register-teacher', 'main', teacherName);
});
```
**Важно:** нужно подключить Socket.IO клиент. Добавь в `index.html` перед `script.js`:
```html
<script src="http://localhost:3000/socket.io/socket.io.js"></script>
```

### Секция 2: Мониторинг ПК (сетка карточек)

Прослушивай два события:

**Обновление списка агентов:**
```
socket.on('agents-list', (agents)) =>
  - Получить элемент #monitoring-grid
  - Очистить его innerHTML
  - Для каждого агента создать карточку:
    <div class="pc-card" data-agent-id="agent.id">
      <img class="screenshot" src="" alt="screen">
      <div class="pc-info">
        <span class="pc-name">{agent.name}</span>
        <button class="btn-control">🖱️ Управление</button>
      </div>
    </div>
  - Кнопка "Управление" при клике вызывает openRemoteControl(agent.id, agent.name)
  - Обновить #agents-count текстом agents.length
```

**Обновление скриншотов (каждую секунду):**
```
socket.on('agent-screenshot', ({ agentId, imageBase64 })) =>
  - Найти карточку: document.querySelector(`[data-agent-id="${agentId}"] .screenshot`)
  - Если найдена: card.src = 'data:image/jpeg;base64,' + imageBase64
```

### Секция 3: Переключение табов

```javascript
const tabMonitoring = document.getElementById('tab-monitoring');
const tabWhiteboard = document.getElementById('tab-whiteboard');
const monitoringGrid = document.getElementById('monitoring-grid');
const whiteboardContainer = document.getElementById('whiteboard-container');
const whiteboardTools = document.getElementById('whiteboard-tools-section');

tabMonitoring.addEventListener('click', () => {
  tabMonitoring.classList.add('active');
  tabWhiteboard.classList.remove('active');
  monitoringGrid.classList.remove('hidden');
  whiteboardContainer.classList.add('hidden');
  whiteboardTools.classList.add('hidden');
});

tabWhiteboard.addEventListener('click', () => {
  tabWhiteboard.classList.add('active');
  tabMonitoring.classList.remove('active');
  whiteboardContainer.classList.remove('hidden');
  monitoringGrid.classList.add('hidden');
  whiteboardTools.classList.remove('hidden');
  setupCanvas();
});
```

### Секция 4: Онлайн-доска

Перенеси логику доски из текущего `public/script.js` (или `online/script.js`). Ключевые вещи:

**Переменные:**
```javascript
const whiteboard = document.getElementById('whiteboard');
const ctx = whiteboard.getContext('2d');
let isDrawing = false;
let lastX = 0, lastY = 0;
let currentTool = 'brush'; // 'brush' или 'eraser'
```

**Функция setupCanvas():**
- Получи размер контейнера `#whiteboard-container`.
- Если ширина или высота = 0 — вернись (return).
- Сохрани текущее содержимое canvas во временный canvas.
- Установи canvas.width и canvas.height с учётом devicePixelRatio.
- ctx.scale(dpr, dpr), ctx.lineCap = 'round', ctx.lineJoin = 'round'.
- Восстанови содержимое из временного canvas.

**Функция drawOnCanvas(x0, y0, x1, y1, color, width, emit, tool):**
- Если tool === 'eraser': `ctx.globalCompositeOperation = 'destination-out'`.
- Иначе: `ctx.globalCompositeOperation = 'source-over'`.
- Нарисовать линию от (x0,y0) до (x1,y1).
- Сбросить: `ctx.globalCompositeOperation = 'source-over'`.
- Если emit === true: `socket.emit('draw', { x0/w, y0/h, x1/w, y1/h, color, width, tool })`.

**События мыши на canvas:** mousedown (start), mousemove (draw), mouseup/mouseout (stop).

**Кнопки инструментов:**
- `#tool-brush` click → currentTool = 'brush', показать `#brush-color-row`.
- `#tool-eraser` click → currentTool = 'eraser', скрыть `#brush-color-row`.
- `#clear-canvas-btn` click → ctx.clearRect(), `socket.emit('clear-canvas')`.

**Сокет-события доски:**
- `socket.on('draw', data)` → вызвать drawOnCanvas с emit=false.
- `socket.on('clear-canvas')` → ctx.clearRect().

### Секция 5: Удалённое управление (модалка)

```javascript
function openRemoteControl(agentId, agentName) {
  document.getElementById('remote-modal').classList.remove('hidden');
  document.getElementById('remote-modal-title').innerText = 'Управление: ' + agentName;
  socket.emit('request-agent-screen', agentId);
  // WebRTC сигналинг — аналогичен текущей реализации в public/script.js
  // Найди функции viewAgent() и агентский WebRTC в online/script.js и перенеси
}

document.getElementById('remote-modal-close').addEventListener('click', () => {
  document.getElementById('remote-modal').classList.add('hidden');
  // Закрыть peer connection
});
```
Перехват мыши/клавиатуры на `#remote-mouse-catcher` — перенеси из текущего кода (обработчики mousemove, mousedown, mouseup, wheel, keydown, keyup → `socket.emit('agent-control', ...)`).

## ✅ Проверка завершения
- [ ] При запуске teacher подключается к серверу (видно в консоли сервера).
- [ ] Переключение табов работает (Мониторинг ↔ Доска).
- [ ] На вкладке «Доска» можно рисовать кистью.
- [ ] Ластик стирает нарисованное.
- [ ] Кнопка «Очистить» стирает всё.
- [ ] При переключении на доску справа появляются инструменты.
