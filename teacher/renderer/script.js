// --- Глобальные переменные и инициализация ---
let socket;
try {
    socket = io('http://localhost:3000');
} catch (e) {
    console.warn('[TEACHER] Socket.io не загружен. Работаем в оффлайн-режиме.');
    socket = { on: () => {}, emit: () => {} }; // Заглушка
}
const teacherName = 'Учитель'; // В будущем можно брать из настроек

// Элементы UI: Навигация
const tabMonitoring = document.getElementById('tab-monitoring');
const tabWhiteboard = document.getElementById('tab-whiteboard');
const monitoringGrid = document.getElementById('monitoring-grid');
const whiteboardContainer = document.getElementById('whiteboard-container');
const whiteboardTools = document.getElementById('whiteboard-tools-section');

// Элементы UI: Списки
const agentsListUl = document.getElementById('agents-list');
const onlineUsersListUl = document.getElementById('online-users-list');
const agentsCountSpan = document.getElementById('agents-count');
const onlineCountSpan = document.getElementById('online-count');

// Элементы UI: Доска
const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
let isDrawing = false;
let lastX = 0, lastY = 0;
let currentTool = 'brush'; // 'brush' или 'eraser'

// --- Подключение к серверу ---
socket.on('connect', () => {
    console.log('[TEACHER] Подключено к серверу:', socket.id);
    socket.emit('register-teacher', 'main', teacherName);
});

// --- Секция 1: Мониторинг ПК ---

// Обновление списка агентов в сетке
socket.on('agents-list', (agents) => {
    agentsCountSpan.textContent = agents.length;
    
    // Очищаем текущую сетку и список слева
    monitoringGrid.innerHTML = '';
    agentsListUl.innerHTML = '';

    if (agents.length === 0) {
        monitoringGrid.innerHTML = '<div class="grid-placeholder">Ожидание подключения компьютеров...</div>';
    }

    agents.forEach(agent => {
        // Создаем карточку в сетке
        const card = document.createElement('div');
        card.className = 'pc-card';
        card.setAttribute('data-agent-id', agent.id);
        card.innerHTML = `
            <img class="screenshot" id="screen-${agent.id}" src="" alt="Экран ${agent.name}">
            <div class="pc-info">
                <span class="pc-name">${agent.name}</span>
                <button class="btn btn-primary" style="padding: 4px 8px; font-size: 0.7rem;" onclick="openRemoteControl('${agent.id}', '${agent.name}')">🖱️ Управление</button>
            </div>
        `;
        monitoringGrid.appendChild(card);

        // Добавляем в список слева
        const li = document.createElement('li');
        li.className = 'item-list-entry';
        li.innerHTML = `<span>🖥️ ${agent.name}</span> <span class="status-dot"></span>`;
        agentsListUl.appendChild(li);
    });
});

// Получение скриншота (обновление конкретной карточки)
socket.on('agent-screenshot', ({ agentId, imageBase64 }) => {
    const img = document.getElementById(`screen-${agentId}`);
    if (img) {
        img.src = 'data:image/jpeg;base64,' + imageBase64;
    }
});

// --- Секция 2: Переключение табов ---

tabMonitoring.addEventListener('click', () => {
    tabMonitoring.classList.add('active');
    tabWhiteboard.classList.remove('active');
    
    monitoringGrid.classList.remove('hidden');
    whiteboardContainer.classList.add('hidden');
    whiteboardTools.classList.add('hidden');
    
    socket.emit('whiteboard-mode', false);
});

tabWhiteboard.addEventListener('click', () => {
    tabWhiteboard.classList.add('active');
    tabMonitoring.classList.remove('active');
    
    whiteboardContainer.classList.remove('hidden');
    monitoringGrid.classList.add('hidden');
    whiteboardTools.classList.remove('hidden');
    
    socket.emit('whiteboard-mode', true);
    setupCanvas();
});

// --- Секция 3: Онлайн-доска ---

function setupCanvas() {
    // Подгоняем размер холста под контейнер
    const rect = whiteboardContainer.getBoundingClientRect();
    if (rect.width === 0) return;

    // Сохраняем текущее изображение
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    tempCtx.drawImage(canvas, 0, 0);

    canvas.width = rect.width;
    canvas.height = rect.height;

    // Стили линий
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = document.getElementById('colorPicker').value;
    ctx.lineWidth = document.getElementById('lineWidth').value;

    // Восстанавливаем изображение
    ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
}

// Следим за изменением размера окна
window.addEventListener('resize', () => {
    if (!whiteboardContainer.classList.contains('hidden')) {
        setupCanvas();
    }
});

function draw(e) {
    if (!isDrawing) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);

    if (currentTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 20; // Ластик по умолчанию толще
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = document.getElementById('colorPicker').value;
        ctx.lineWidth = document.getElementById('lineWidth').value;
    }

    ctx.stroke();

    // Отправка на сервер
    socket.emit('draw', {
        x0: lastX / canvas.width,
        y0: lastY / canvas.height,
        x1: x / canvas.width,
        y1: y / canvas.height,
        color: ctx.strokeStyle,
        width: ctx.lineWidth,
        tool: currentTool
    });

    [lastX, lastY] = [x, y];
}

canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    [lastX, lastY] = [e.clientX - rect.left, e.clientY - rect.top];
});

canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', () => isDrawing = false);
canvas.addEventListener('mouseout', () => isDrawing = false);

// Инструменты доски
document.getElementById('tool-brush').addEventListener('click', function() {
    currentTool = 'brush';
    this.classList.add('active');
    document.getElementById('tool-eraser').classList.remove('active');
    document.getElementById('brush-color-row').classList.remove('hidden');
});

document.getElementById('tool-eraser').addEventListener('click', function() {
    currentTool = 'eraser';
    this.classList.add('active');
    document.getElementById('tool-brush').classList.remove('active');
    document.getElementById('brush-color-row').classList.add('hidden');
});

document.getElementById('clear-canvas-btn').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clear-canvas');
});

// Слушаем события рисования от других (если учитель не один, или для синхронизации)
socket.on('draw', (data) => {
    const x0 = data.x0 * canvas.width;
    const y0 = data.y0 * canvas.height;
    const x1 = data.x1 * canvas.width;
    const y1 = data.y1 * canvas.height;

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    
    if (data.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = data.color;
    }
    
    ctx.lineWidth = data.width;
    ctx.stroke();
});

socket.on('clear-canvas', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// --- Секция 4: Удаленное управление (Модалка) ---

window.openRemoteControl = function(agentId, agentName) {
    document.getElementById('remote-modal').classList.remove('hidden');
    document.getElementById('remote-modal-title').innerText = 'Удаленное управление: ' + agentName;
    
    // Запрос потока от агента
    socket.emit('request-agent-screen', agentId);
    
    // Здесь будет WebRTC сигналинг в task-05
};

document.getElementById('remote-modal-close').addEventListener('click', () => {
    document.getElementById('remote-modal').classList.add('hidden');
    // Остановить поток, если есть
});

// --- Секция 6: Демонстрация экрана (Учитель -> Все) ---

let localStream = null;
let isBroadcasting = false;
const peerConnections = {};
const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let selectedFps = 30;

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

document.getElementById('btn-start-broadcast').addEventListener('click', async () => {
    const quality = document.getElementById('qualitySelect').value;
    const [w, h] = quality.split('x').map(Number);

    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: w, max: w },
                height: { ideal: h, max: h },
                frameRate: { ideal: selectedFps, max: selectedFps }
            },
            audio: true
        });

        document.getElementById('preview-video').srcObject = localStream;
        document.getElementById('btn-start-broadcast').classList.add('hidden');
        document.getElementById('btn-stop-broadcast').classList.remove('hidden');
        document.getElementById('preview-placeholder').classList.add('hidden');
        
        isBroadcasting = true;
        socket.emit('start-broadcast');

        // Остановка через встроенный UI браузера
        localStream.getVideoTracks()[0].onended = () => {
            stopBroadcast();
        };

    } catch (err) {
        console.error('[TEACHER] Ошибка захвата экрана:', err);
    }
});

function stopBroadcast() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    document.getElementById('preview-video').srcObject = null;
    document.getElementById('btn-start-broadcast').classList.remove('hidden');
    document.getElementById('btn-stop-broadcast').classList.add('hidden');
    document.getElementById('preview-placeholder').classList.remove('hidden');
    isBroadcasting = false;
    socket.emit('stop-broadcast');

    for (let id in peerConnections) {
        peerConnections[id].close();
        delete peerConnections[id];
    }
}

document.getElementById('btn-stop-broadcast').addEventListener('click', stopBroadcast);

socket.on('initiate-peer-connections', async (users) => {
    for (const user of users) {
        const target = user.id;
        const pc = new RTCPeerConnection(iceConfig);
        peerConnections[target] = pc;

        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socket.emit('ice-candidate', { target, candidate: e.candidate });
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { target, sdp: pc.localDescription });
    }
});

socket.on('answer', async ({ source, sdp }) => {
    if (peerConnections[source]) {
        await peerConnections[source].setRemoteDescription(sdp);
    }
});

socket.on('ice-candidate', async ({ source, candidate }) => {
    if (peerConnections[source]) {
        await peerConnections[source].addIceCandidate(candidate);
    }
});

// --- Секция 7: Чат ---

const chatInput = document.getElementById('chat-text-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatMessages = document.getElementById('chat-messages');

chatSendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => { 
    if (e.key === 'Enter') sendMessage(); 
});

function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat-message', { sender: teacherName, text });
    chatInput.value = '';
}

document.getElementById('chat-attach-btn').addEventListener('click', () => {
    document.getElementById('chat-file-input').click();
});

document.getElementById('chat-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sender', teacherName);
    
    try {
        await fetch('http://localhost:3000/upload', { 
            method: 'POST', 
            body: formData 
        });
    } catch (err) {
        console.error('[TEACHER] Загрузка файла не удалась', err);
    }
    
    e.target.value = ''; // сбросить input
});

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

// --- Секция 8: Онлайн-участники ---

socket.on('online-users-list', (users) => {
    onlineCountSpan.textContent = users.length;
    onlineUsersListUl.innerHTML = '';
    users.forEach(u => {
        const li = document.createElement('li');
        li.className = 'item-list-entry';
        li.innerHTML = `<span>👤 ${u.name}</span> <span class="status-dot"></span>`;
        onlineUsersListUl.appendChild(li);
    });
});

socket.on('online-user-sharing', ({ userId, name }) => {
    console.log(`[TEACHER] ${name} (${userId}) начал демонстрацию экрана`);
    // TODO: Добавить интерфейс просмотра демонстрации участника
});

// --- Секция 9: Запись экрана учителя ---

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordTimer = null;
let recordSeconds = 0;

const recordBtn = document.getElementById('recordBtn');
const recordTimerEl = document.getElementById('record-timer');

recordBtn.addEventListener('click', async () => {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
});

async function startRecording() {
    try {
        // Получить список окон через preload
        const sources = await window.electronAPI.getSources();
        // Найти окно приложения учителя
        const appSource = sources.find(s => s.name.toLowerCase().includes('classcontrol') || s.name.includes('Учитель'));
        if (!appSource) {
            alert('Не удалось найти окно приложения для записи. Доступные окна: ' + sources.map(s => s.name).join(', '));
            return;
        }

        // Захватить видео окна приложения
        let stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'desktop'
                }
            },
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: appSource.id,
                    maxWidth: 1920,
                    maxHeight: 1080,
                    maxFrameRate: 30
                }
            }
        });

        // Добавить микрофон
        try {
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioCtx = new AudioContext();
            const dest = audioCtx.createMediaStreamDestination();
            // Системный звук
            if (stream.getAudioTracks().length > 0) {
                audioCtx.createMediaStreamSource(stream).connect(dest);
            }
            // Микрофон
            audioCtx.createMediaStreamSource(micStream).connect(dest);
            // Объединить видео + смешанный аудио
            stream = new MediaStream([
                ...stream.getVideoTracks(),
                ...dest.stream.getAudioTracks()
            ]);
        } catch (micErr) {
            console.warn('Микрофон недоступен, записываем без него:', micErr);
        }

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            // Автоматически скачать файл
            const a = document.createElement('a');
            const now = new Date();
            const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
            a.href = url;
            a.download = `запись_${dateStr}.webm`;
            a.click();
            URL.revokeObjectURL(url);
        };

        mediaRecorder.start(1000); // chunk каждую секунду
        isRecording = true;

        // UI
        recordBtn.textContent = '⏹ Стоп';
        recordBtn.style.color = '#ef4444';
        recordTimerEl.classList.remove('hidden');
        recordSeconds = 0;
        recordTimer = setInterval(() => {
            recordSeconds++;
            const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
            const s = String(recordSeconds % 60).padStart(2, '0');
            recordTimerEl.textContent = `${m}:${s}`;
        }, 1000);

    } catch (err) {
        console.error('Ошибка начала записи:', err);
        alert('Не удалось начать запись: ' + err.message);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        // Остановить все треки
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    isRecording = false;
    recordBtn.textContent = '🔴 Запись';
    recordBtn.style.color = '';
    recordTimerEl.classList.add('hidden');
    clearInterval(recordTimer);
}
