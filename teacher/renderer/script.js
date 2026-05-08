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
socket.on('connect', async () => {
    console.log('[TEACHER] Подключено к серверу:', socket.id);
    let token = '';
    if (window.electronAPI && window.electronAPI.getTeacherToken) {
        token = await window.electronAPI.getTeacherToken();
    }
    socket.emit('register-teacher', 'main', teacherName, token);
});

socket.on('auth-error', (msg) => {
    console.error('[TEACHER] Ошибка авторизации:', msg);
});

// --- Секция 1: Мониторинг ПК ---

// Обновление списка агентов (дифференциальное — без мерцания)
socket.on('agents-list', (agents) => {
    agentsCountSpan.textContent = agents.length;
    
    const currentIds = new Set(agents.map(a => a.id));
    const existingCards = monitoringGrid.querySelectorAll('.pc-card');
    const existingIds = new Set();

    // Удалить карточки отключённых агентов
    existingCards.forEach(card => {
        const id = card.getAttribute('data-agent-id');
        if (!currentIds.has(id)) {
            card.remove();
        } else {
            existingIds.add(id);
        }
    });

    // Удалить placeholder если есть агенты
    const placeholder = monitoringGrid.querySelector('.grid-placeholder');
    if (agents.length > 0 && placeholder) placeholder.remove();
    if (agents.length === 0 && !placeholder) {
        monitoringGrid.innerHTML = '<div class="grid-placeholder">Ожидание подключения компьютеров...</div>';
    }

    // Добавить новые карточки (только для новых агентов)
    agents.forEach(agent => {
        if (!existingIds.has(agent.id)) {
            const card = document.createElement('div');
            card.className = 'pc-card';
            card.setAttribute('data-agent-id', agent.id);

            const img = document.createElement('img');
            img.className = 'screenshot';
            img.id = `screen-${agent.id}`;
            img.src = '';
            img.alt = `Экран ${agent.name}`;
            card.appendChild(img);

            const infoDiv = document.createElement('div');
            infoDiv.className = 'pc-info';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'pc-name';
            nameSpan.textContent = agent.name;
            infoDiv.appendChild(nameSpan);

            const controlBtn = document.createElement('button');
            controlBtn.className = 'btn btn-primary';
            controlBtn.style.cssText = 'padding: 4px 8px; font-size: 0.7rem;';
            controlBtn.textContent = 'Управление';
            controlBtn.addEventListener('click', () => openRemoteControl(agent.id, agent.name));
            infoDiv.appendChild(controlBtn);

            card.appendChild(infoDiv);
            monitoringGrid.appendChild(card);
        }
    });

    // Обновить список слева
    agentsListUl.innerHTML = '';
    agents.forEach(agent => {
        const li = document.createElement('li');
        li.className = 'item-list-entry';
        const liSpan = document.createElement('span');
        liSpan.textContent = agent.name;
        li.appendChild(liSpan);
        const dotSpan = document.createElement('span');
        dotSpan.className = 'status-dot';
        li.appendChild(dotSpan);
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
    if (canvas.width !== 3840) {
        canvas.width = 3840;
        canvas.height = 2160;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = document.getElementById('colorPicker').value;
    ctx.lineWidth = document.getElementById('lineWidth').value;

    if (typeof applyTransform === 'function') applyTransform();
}

// Следим за изменением размера окна
window.addEventListener('resize', () => {
    if (!whiteboardContainer.classList.contains('hidden')) {
        setupCanvas();
    }
});

let zoomLevel = 1;
let panX = 0, panY = 0;
let isPanning = false;

function applyTransform() {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    const zl = document.getElementById('zoom-level');
    if (zl) zl.textContent = Math.round(zoomLevel * 100) + '%';
    
    socket.emit('whiteboard-transform', {
        zoom: zoomLevel,
        panX: panX / canvas.offsetWidth,
        panY: panY / canvas.offsetHeight
    });
}

whiteboardContainer.addEventListener('mousedown', (e) => {
    if (e.target !== canvas && e.target !== whiteboardContainer) return;
    
    // Средняя кнопка мыши (колесико) ИЛИ выбран инструмент "Рука"
    if (currentTool === 'hand' || e.button === 1) {
        isPanning = true;
        whiteboardContainer.style.cursor = 'grabbing';
    } else if (e.button === 0 && e.target === canvas) {
        isDrawing = true;
        const rect = canvas.getBoundingClientRect();
        lastX = (e.clientX - rect.left) * (canvas.width / rect.width);
        lastY = (e.clientY - rect.top) * (canvas.height / rect.height);

        const stroke = {
            x0: lastX / canvas.width,
            y0: lastY / canvas.height,
            x1: (lastX + 1) / canvas.width,
            y1: (lastY + 1) / canvas.height,
            color: document.getElementById('colorPicker').value,
            width: (currentTool === 'eraser' ? 60 : document.getElementById('lineWidth').value * 2) / canvas.width,
            tool: currentTool
        };
        drawStroke(stroke);
        socket.emit('draw', stroke);
    }
});

window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        panX += e.movementX;
        panY += e.movementY;
        applyTransform();
    } else if (isDrawing) {
        const rect = canvas.getBoundingClientRect();
        // Математика автоматически учитывает зум и смещение!
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);

        // THROTTLE (Anti-lag) - Игнорируем микро-движения (меньше 3 вирт. пикселей)
        const dx = x - lastX;
        const dy = y - lastY;
        if (dx * dx + dy * dy < 9) return;

        const stroke = {
            x0: lastX / canvas.width,
            y0: lastY / canvas.height,
            x1: x / canvas.width,
            y1: y / canvas.height,
            color: document.getElementById('colorPicker').value,
            width: (currentTool === 'eraser' ? 60 : document.getElementById('lineWidth').value * 2) / canvas.width,
            tool: currentTool
        };
        drawStroke(stroke);
        socket.emit('draw', stroke);
        [lastX, lastY] = [x, y];
    }
});

window.addEventListener('mouseup', () => {
    if (isPanning) {
        isPanning = false;
        whiteboardContainer.style.cursor = currentTool === 'hand' ? 'grab' : 'crosshair';
    }
    isDrawing = false;
});

// Зум и панорамирование колесиком мыши (как в Figma)
whiteboardContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || currentTool === 'hand') {
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        zoomLevel = Math.max(0.5, Math.min(5, zoomLevel + delta));
    } else {
        panX -= e.deltaX;
        panY -= e.deltaY;
    }
    applyTransform();
}, { passive: false });

// Кнопки интерфейса зума
document.getElementById('zoom-in').addEventListener('click', () => { zoomLevel = Math.min(5, zoomLevel + 0.2); applyTransform(); });
document.getElementById('zoom-out').addEventListener('click', () => { zoomLevel = Math.max(0.5, zoomLevel - 0.2); applyTransform(); });
document.getElementById('zoom-reset').addEventListener('click', () => { zoomLevel = 1; panX = 0; panY = 0; applyTransform(); });

// Инструменты доски
function setActiveTool(btn) {
    document.querySelectorAll('.tools-grid .tool-btn:not(.danger)').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    whiteboardContainer.style.cursor = currentTool === 'hand' ? 'grab' : 'crosshair';
}

document.getElementById('tool-brush').addEventListener('click', function() {
    currentTool = 'brush'; setActiveTool(this);
    document.getElementById('brush-color-row').classList.remove('hidden');
});

document.getElementById('tool-eraser').addEventListener('click', function() {
    currentTool = 'eraser'; setActiveTool(this);
    document.getElementById('brush-color-row').classList.add('hidden');
});

document.getElementById('tool-hand').addEventListener('click', function() {
    currentTool = 'hand'; setActiveTool(this);
    document.getElementById('brush-color-row').classList.add('hidden');
});

document.getElementById('clear-canvas-btn').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clear-canvas');
});

function drawStroke(data) {
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
    
    ctx.lineWidth = data.width * canvas.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
}

socket.on('draw', drawStroke);

socket.on('canvas-history', (history) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    history.forEach(drawStroke);
});

socket.on('clear-canvas', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// --- Секция 4: Удаленное управление (Модалка) ---

let remoteAgentPC = null;
let currentRemoteAgentId = null;

window.openRemoteControl = function(agentId, agentName) {
    currentRemoteAgentId = agentId;
    document.getElementById('remote-modal').classList.remove('hidden');
    document.getElementById('remote-modal-title').innerText = 'Удаленное управление: ' + agentName;
    document.getElementById('remote-video').srcObject = null;
    
    socket.emit('request-agent-screen', agentId);
};

// Получение offer (от агента или от онлайн-ученика)
socket.on('offer', async ({ source, sdp, connectionType }) => {
    if (connectionType === 'share' || source === currentShareUserId) {
        handleStudentShareOffer(source, sdp);
        return;
    }
    if (connectionType === 'remote' || source === currentRemoteAgentId || agents_contains(source)) {
        console.log('[TEACHER] Получен offer от агента:', source);
        if (remoteAgentPC) remoteAgentPC.close();
        remoteAgentPC = new RTCPeerConnection(iceConfig);

        remoteAgentPC.ontrack = (e) => {
            console.log('[TEACHER] Получен видео-поток от агента');
            document.getElementById('remote-video').srcObject = e.streams[0];
        };

        remoteAgentPC.onicecandidate = (e) => {
            if (e.candidate) {
                socket.emit('ice-candidate', { target: source, candidate: e.candidate, connectionType: 'remote' });
            }
        };

        remoteAgentPC.onconnectionstatechange = () => {
            console.log('[TEACHER] Remote agent connection:', remoteAgentPC.connectionState);
        };

        await remoteAgentPC.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await remoteAgentPC.createAnswer();
        await remoteAgentPC.setLocalDescription(answer);
        socket.emit('answer', { target: source, sdp: remoteAgentPC.localDescription, connectionType: 'remote' });
    }
});

function agents_contains(id) {
    return !!document.querySelector(`.pc-card[data-agent-id="${id}"]`);
}

document.getElementById('remote-modal-close').addEventListener('click', () => {
    document.getElementById('remote-modal').classList.add('hidden');
    document.getElementById('remote-video').srcObject = null;
    if (remoteAgentPC) {
        remoteAgentPC.close();
        remoteAgentPC = null;
    }
    currentRemoteAgentId = null;
});

// --- Секция 6: Демонстрация экрана (Учитель -> Все) ---

let localStream = null;
let isBroadcasting = false;
const peerConnections = {};
const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
document.getElementById('btn-start-broadcast').addEventListener('click', async () => {
    const quality = document.getElementById('qualitySelect').value;
    const [w, h] = quality.split('x').map(Number);
    const selectedFps = parseInt(document.getElementById('fpsSelect').value, 10);

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
                socket.emit('ice-candidate', { target, candidate: e.candidate, connectionType: 'broadcast' });
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { target, sdp: pc.localDescription, connectionType: 'broadcast' });
    }
});

socket.on('answer', async ({ source, sdp }) => {
    if (peerConnections[source]) {
        await peerConnections[source].setRemoteDescription(sdp);
    }
});

async function handleStudentShareOffer(source, sdp) {
    console.log('[TEACHER] Получен offer от ученика:', source);
    if (studentSharePC) studentSharePC.close();
    studentSharePC = new RTCPeerConnection(iceConfig);

    studentSharePC.ontrack = (e) => {
        console.log('[TEACHER] Получен поток от ученика');
        document.getElementById('student-share-video').srcObject = e.streams[0];
        document.getElementById('student-share-status').textContent = '';
    };

    studentSharePC.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { target: source, candidate: e.candidate, connectionType: 'share' });
        }
    };

    studentSharePC.onconnectionstatechange = () => {
        console.log('[TEACHER] Student share connection:', studentSharePC.connectionState);
    };

    await studentSharePC.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await studentSharePC.createAnswer();
    await studentSharePC.setLocalDescription(answer);
    socket.emit('answer', { target: source, sdp: studentSharePC.localDescription, connectionType: 'share' });
}

socket.on('ice-candidate', async ({ source, candidate, connectionType }) => {
    if (connectionType === 'broadcast' && peerConnections[source]) {
        try {
            await peerConnections[source].addIceCandidate(candidate);
        } catch (err) {
            console.error('[TEACHER] ICE error for broadcast:', err);
        }
    } else if (connectionType === 'share' && studentSharePC) {
        try {
            await studentSharePC.addIceCandidate(candidate);
        } catch (err) {
            console.error('[TEACHER] ICE error for student share:', err);
        }
    } else if (connectionType === 'remote' && remoteAgentPC) {
        try {
            await remoteAgentPC.addIceCandidate(candidate);
        } catch (err) {
            console.error('[TEACHER] ICE error for remote agent:', err);
        }
    } else {
        // Fallback for backward compat: try all matching PCs
        if (peerConnections[source]) {
            try { await peerConnections[source].addIceCandidate(candidate); } catch (e) {}
        }
        if (source === currentShareUserId && studentSharePC) {
            try { await studentSharePC.addIceCandidate(candidate); } catch (e) {}
        }
        if (remoteAgentPC && source === currentRemoteAgentId) {
            try { await remoteAgentPC.addIceCandidate(candidate); } catch (e) {}
        }
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

// Палитра цветов для учеников (12 контрастных оттенков)
const STUDENT_COLORS = [
    '#f472b6', '#fb923c', '#facc15', '#4ade80',
    '#2dd4bf', '#38bdf8', '#818cf8', '#c084fc',
    '#e879f9', '#f87171', '#a3e635', '#22d3ee'
];
const studentColorMap = {};

function getStudentColor(name) {
    if (studentColorMap[name]) return studentColorMap[name];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const idx = Math.abs(hash) % STUDENT_COLORS.length;
    studentColorMap[name] = STUDENT_COLORS[idx];
    return STUDENT_COLORS[idx];
}

function isTeacher(senderName) {
    return senderName === teacherName;
}

function renderChatMessage(msg) {
    const div = document.createElement('div');
    const teacher = isTeacher(msg.sender);
    div.className = 'chat-msg' + (teacher ? ' chat-msg--teacher' : ' chat-msg--student');

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'chat-msg-content';

    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';

    if (!teacher) {
        const badge = document.createElement('span');
        badge.className = 'sender-badge';
        badge.style.background = getStudentColor(msg.sender);
        senderSpan.appendChild(badge);
    }

    senderSpan.appendChild(document.createTextNode(msg.sender + ':'));
    if (!teacher) senderSpan.style.color = getStudentColor(msg.sender);

    contentWrapper.appendChild(senderSpan);
    contentWrapper.appendChild(document.createTextNode(' ' + msg.text));
    
    div.appendChild(contentWrapper);
    chatMessages.appendChild(div);
    
    // Проверяем, если сообщение слишком длинное (больше 120px по высоте)
    if (contentWrapper.scrollHeight > 120) {
        contentWrapper.classList.add('collapsed');
        
        const readMoreBtn = document.createElement('button');
        readMoreBtn.className = 'chat-read-more';
        readMoreBtn.textContent = 'Читать далее...';
        readMoreBtn.onclick = () => {
            const isCollapsed = contentWrapper.classList.toggle('collapsed');
            readMoreBtn.textContent = isCollapsed ? 'Читать далее...' : 'Скрыть';
        };
        div.appendChild(readMoreBtn);
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderChatFile(msg) {
    const div = document.createElement('div');
    const teacher = isTeacher(msg.sender);
    div.className = 'chat-msg chat-file' + (teacher ? ' chat-msg--teacher' : ' chat-msg--student');
    const sizeMB = (msg.size / 1024 / 1024).toFixed(1);
    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';

    if (!teacher) {
        const badge = document.createElement('span');
        badge.className = 'sender-badge';
        badge.style.background = getStudentColor(msg.sender);
        senderSpan.appendChild(badge);
    }

    senderSpan.appendChild(document.createTextNode(msg.sender + ':'));
    if (!teacher) senderSpan.style.color = getStudentColor(msg.sender);

    div.appendChild(senderSpan);
    div.appendChild(document.createTextNode(' '));
    const link = document.createElement('a');
    link.href = `http://localhost:3000${msg.url}`;
    link.target = '_blank';
    link.download = msg.filename;
    link.textContent = msg.filename;
    div.appendChild(link);
    div.appendChild(document.createTextNode(` (${sizeMB} MB)`));
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- Секция 8: Онлайн-участники ---

let currentOnlineUsers = [];
const sharingUsers = new Set(); // Хранит ID учеников, которые сейчас транслируют

socket.on('online-users-list', (users) => {
    currentOnlineUsers = users;
    onlineCountSpan.textContent = users.length;
    renderOnlineUsersList();
});

function renderOnlineUsersList() {
    onlineUsersListUl.innerHTML = '';
    currentOnlineUsers.forEach(u => {
        const li = document.createElement('li');
        li.className = 'item-list-entry';
        
        const uSpan = document.createElement('span');
        uSpan.style.display = 'flex';
        uSpan.style.alignItems = 'center';
        uSpan.style.gap = '6px';
        // Строгая SVG-иконка пользователя вместо эмодзи
        uSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> <span>${u.name}</span>`;
        li.appendChild(uSpan);
        
        if (sharingUsers.has(u.id)) {
            const watchBtn = document.createElement('button');
            watchBtn.className = 'btn btn-primary';
            watchBtn.style.cssText = 'padding: 3px 8px; font-size: 0.65rem;';
            watchBtn.textContent = 'Смотреть';
            watchBtn.onclick = () => showStudentShareModal(u.id, u.name);
            li.appendChild(watchBtn);
        } else {
            const uDot = document.createElement('span');
            uDot.className = 'status-dot';
            li.appendChild(uDot);
        }
        
        onlineUsersListUl.appendChild(li);
    });
}

// --- Просмотр демонстрации экрана онлайн-ученика ---
let studentSharePC = null;
let currentShareUserId = null;

socket.on('online-user-sharing', ({ userId, name }) => {
    console.log(`[TEACHER] ${name} (${userId}) запустил трансляцию`);
    sharingUsers.add(userId);
    renderOnlineUsersList(); // Перерисовываем список, чтобы появилась кнопка
});

socket.on('online-user-stopped-sharing', ({ userId }) => {
    console.log(`[TEACHER] Ученик ${userId} остановил демонстрацию`);
    sharingUsers.delete(userId);
    renderOnlineUsersList(); // Перерисовываем список, убираем кнопку
    if (currentShareUserId === userId) {
        closeStudentShareModal();
    }
});

function showStudentShareModal(userId, name) {
    currentShareUserId = userId;
    const modal = document.getElementById('student-share-modal');
    document.getElementById('student-share-title').textContent = `Демонстрация: ${name}`;
    modal.classList.remove('hidden');
    document.getElementById('student-share-status').textContent = 'Подключение...';
    document.getElementById('student-share-video').srcObject = null;
    socket.emit('teacher-accept-share', { userId });
}

function closeStudentShareModal() {
    const modal = document.getElementById('student-share-modal');
    modal.classList.add('hidden');
    if (studentSharePC) {
        studentSharePC.close();
        studentSharePC = null;
    }
    if (currentShareUserId) {
        socket.emit('teacher-close-share', { userId: currentShareUserId });
        currentShareUserId = null;
    }
    document.getElementById('student-share-video').srcObject = null;
}

document.getElementById('student-share-close').addEventListener('click', closeStudentShareModal);

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
        // Геометрически правильный SVG-квадрат вместо эмодзи
        recordBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg> <span>Стоп</span>`;
        recordBtn.style.color = 'var(--c-red)';
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
    // Возвращаем оригинальный SVG-кружок при остановке записи
    recordBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg> <span>Запись</span>`;
    recordBtn.style.color = '';
    recordTimerEl.classList.add('hidden');
    clearInterval(recordTimer);
}

// --- Секция 10: Изменение ширины панелей (Resizer) ---

const resizerLeft = document.getElementById('resizer-left');
const resizerRight = document.getElementById('resizer-right');
const panelLeft = document.getElementById('panel-left');
const panelRight = document.getElementById('panel-right');

let isResizingLeft = false;
let isResizingRight = false;

if (resizerLeft && panelLeft) {
    resizerLeft.addEventListener('mousedown', (e) => {
        isResizingLeft = true;
        document.body.style.cursor = 'col-resize';
    });
}

if (resizerRight && panelRight) {
    resizerRight.addEventListener('mousedown', (e) => {
        isResizingRight = true;
        document.body.style.cursor = 'col-resize';
    });
}

document.addEventListener('mousemove', (e) => {
    if (!isResizingLeft && !isResizingRight) return;
    
    if (isResizingLeft) {
        let newWidth = e.clientX;
        if (newWidth < 250) newWidth = 250; // Минимальная ширина левой панели
        if (newWidth > 600) newWidth = 600; // Максимальная ширина левой панели
        panelLeft.style.width = `${newWidth}px`;
        panelLeft.style.flex = 'none';
    }
    
    if (isResizingRight) {
        let newWidth = window.innerWidth - e.clientX;
        if (newWidth < 250) newWidth = 250; // Минимальная ширина правой панели
        if (newWidth > 600) newWidth = 600; // Максимальная ширина правой панели
        panelRight.style.width = `${newWidth}px`;
        panelRight.style.flex = 'none';
    }
});

document.addEventListener('mouseup', () => {
    if (isResizingLeft || isResizingRight) {
        isResizingLeft = false;
        isResizingRight = false;
        document.body.style.cursor = '';
    }
});
