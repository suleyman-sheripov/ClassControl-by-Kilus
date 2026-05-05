const socket = io();
let myName = '';
let shareStream = null;
let shareTimerInterval = null;
let sharePC = null; // WebRTC PeerConnection for sending screen share to teacher
let teacherPC = null; // WebRTC PeerConnection for receiving teacher broadcast
const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function showToast(text, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast' + (type === 'info' ? ' info' : '');
    toast.textContent = text;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

// ВХОД
document.getElementById('join-btn').addEventListener('click', () => {
    myName = document.getElementById('name-input').value.trim();
    if (!myName) return alert('Введите имя');
    socket.emit('register-online-user', myName);
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
    document.getElementById('user-name-display').textContent = myName;
    resizeCanvas();
});

// Выход
document.getElementById('leave-btn').addEventListener('click', () => {
    window.location.reload();
});

// --- ЧАТ ---
const chatInput = document.getElementById('msg-input');
const chatSendBtn = document.getElementById('send-btn');
const chatMessages = document.getElementById('chat-messages');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');

chatSendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => { 
    if (e.key === 'Enter') sendMessage(); 
});

function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat-message', { sender: myName, text });
    chatInput.value = '';
}

attachBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sender', myName);
    
    try {
        await fetch(window.location.origin + '/upload', { 
            method: 'POST', 
            body: formData 
        });
    } catch (err) {
        console.error('[ONLINE] File upload failed', err);
    }
    
    e.target.value = '';
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
    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.textContent = msg.sender + ':';
    div.appendChild(senderSpan);
    div.appendChild(document.createTextNode(' ' + msg.text));
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderChatFile(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg file';
    const sizeMB = (msg.size / 1024 / 1024).toFixed(1);
    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.textContent = msg.sender + ':';
    div.appendChild(senderSpan);
    div.appendChild(document.createTextNode(' '));
    const link = document.createElement('a');
    link.href = `${window.location.origin}${msg.url}`;
    link.target = '_blank';
    link.download = msg.filename;
    link.textContent = msg.filename;
    div.appendChild(link);
    div.appendChild(document.createTextNode(` (${sizeMB} MB)`));
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- ПРИЕМ ДЕМОНСТРАЦИИ УЧИТЕЛЯ (WebRTC) ---
socket.on('broadcast-started', () => {
    console.log('[ONLINE] Broadcast started');
    document.querySelector('#waiting-msg span').textContent = 'Подключение к трансляции...';
    showToast('Учитель начал трансляцию', 'info');
});

socket.on('broadcast-stopped', () => {
    console.log('[ONLINE] Broadcast stopped');
    if (teacherPC) {
        teacherPC.close();
        teacherPC = null;
    }
    document.getElementById('teacher-video').srcObject = null;
    document.querySelector('#waiting-msg span').textContent = 'Ожидание демонстрации учителя...';
    document.getElementById('waiting-msg').classList.remove('hidden');
    showToast('Трансляция учителя остановлена', 'info');
});

socket.on('teacher-disconnected', () => {
    console.log('[ONLINE] Учитель отключился');
    document.querySelector('#waiting-msg span').textContent = 'Учитель отключился. Ожидание переподключения...';
    document.getElementById('waiting-msg').classList.remove('hidden');
    showToast('Учитель отключился');
});

// WebRTC: receive offer from teacher, create answer
socket.on('offer', async ({ source, sdp }) => {
    console.log('[ONLINE] Received offer from', source);
    
    // Close previous connection if any
    if (teacherPC) {
        teacherPC.close();
    }
    
    teacherPC = new RTCPeerConnection(iceConfig);
    
    teacherPC.ontrack = (e) => {
        console.log('[ONLINE] Got media track:', e.track.kind);
        document.getElementById('teacher-video').srcObject = e.streams[0]; 
        document.getElementById('waiting-msg').classList.add('hidden');
    };
    
    teacherPC.onicecandidate = (e) => { 
        if (e.candidate) {
            socket.emit('ice-candidate', { target: source, candidate: e.candidate, connectionType: 'broadcast' }); 
        }
    };

    teacherPC.onconnectionstatechange = () => {
        console.log('[ONLINE] Connection state:', teacherPC.connectionState);
    };
    
    await teacherPC.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await teacherPC.createAnswer();
    await teacherPC.setLocalDescription(answer);
    socket.emit('answer', { target: source, sdp: teacherPC.localDescription, connectionType: 'broadcast' });
});

// WebRTC: handle ICE candidates from teacher
socket.on('ice-candidate', async ({ source, candidate, connectionType }) => {
    console.log('[ONLINE] Received ICE candidate from', source, 'type:', connectionType);
    if (connectionType === 'share' && sharePC) {
        try {
            await sharePC.addIceCandidate(candidate);
        } catch (err) {
            console.error('[ONLINE] ICE error (sharePC):', err);
        }
    } else if (connectionType === 'broadcast' && teacherPC) {
        try {
            await teacherPC.addIceCandidate(candidate);
        } catch (err) {
            console.error('[ONLINE] ICE error (teacherPC):', err);
        }
    } else {
        // Fallback: try both
        if (sharePC) { try { await sharePC.addIceCandidate(candidate); } catch(e) {} }
        if (teacherPC) { try { await teacherPC.addIceCandidate(candidate); } catch(e) {} }
    }
});

// --- ДОСКА ---
const canvas = document.getElementById('teacher-canvas');
const ctx = canvas.getContext('2d');
let savedWhiteboardImage = null;

// Zoom & Pan
let zoomLevel = 1;
let panX = 0, panY = 0;
let isPanning = false;
let panStartX = 0, panStartY = 0;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const videoArea = document.getElementById('video-area');

function applyTransform() {
    const content = videoArea.querySelector('video');
    const transforms = `scale(${zoomLevel}) translate(${panX}px, ${panY}px)`;
    if (content) {
        content.style.transform = transforms;
        content.style.transformOrigin = 'center center';
    }
    canvas.style.transform = transforms;
    canvas.style.transformOrigin = 'center center';
}

videoArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomLevel + delta));
    if (newZoom === MIN_ZOOM) {
        panX = 0;
        panY = 0;
    }
    zoomLevel = newZoom;
    applyTransform();
}, { passive: false });

videoArea.addEventListener('mousedown', (e) => {
    if (zoomLevel <= 1) return;
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    videoArea.style.cursor = 'grabbing';
});

videoArea.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    applyTransform();
});

videoArea.addEventListener('mouseup', () => {
    isPanning = false;
    videoArea.style.cursor = zoomLevel > 1 ? 'grab' : 'default';
});

videoArea.addEventListener('mouseleave', () => {
    isPanning = false;
    videoArea.style.cursor = 'default';
});

function resizeCanvas() {
    const rect = document.getElementById('video-area').getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Fixed 16:9 aspect ratio to match teacher's canvas
    const ASPECT = 16 / 9;
    let w = rect.width;
    let h = w / ASPECT;
    if (h > rect.height) {
        h = rect.height;
        w = h * ASPECT;
    }
    canvas.width = Math.floor(w);
    canvas.height = Math.floor(h);
    // Center canvas within video-area
    canvas.style.left = Math.floor((rect.width - canvas.width) / 2) + 'px';
    canvas.style.top = Math.floor((rect.height - canvas.height) / 2) + 'px';
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
}
window.addEventListener('resize', resizeCanvas);

// Whiteboard mode toggle from teacher
socket.on('whiteboard-mode', (active) => {
    console.log('[ONLINE] Whiteboard mode:', active);
    if (active) {
        document.getElementById('waiting-msg').classList.add('hidden');
        canvas.style.background = 'white';
        canvas.style.pointerEvents = 'none';
        resizeCanvas();
        // Restore saved whiteboard drawing if available
        if (savedWhiteboardImage) {
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            img.src = savedWhiteboardImage;
        }
    } else {
        // Save whiteboard drawing before hiding
        if (canvas.width > 0 && canvas.height > 0) {
            savedWhiteboardImage = canvas.toDataURL();
        }
        canvas.style.background = 'transparent';
        if (!document.getElementById('teacher-video').srcObject) {
            document.getElementById('waiting-msg').classList.remove('hidden');
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
});

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
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = data.width;
    ctx.stroke();
});

socket.on('clear-canvas', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    savedWhiteboardImage = null;
});

// --- ПОКАЗ СВОЕГО ЭКРАНА (5 минут) ---
document.getElementById('share-screen-btn').addEventListener('click', async () => {
    try {
        shareStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch (e) { 
        console.error('Screen sharing canceled or failed', e);
        return; 
    }

    socket.emit('online-user-share-screen');

    document.getElementById('share-screen-btn').classList.add('hidden');
    document.getElementById('stop-share-btn').classList.remove('hidden');
    document.getElementById('share-timer').classList.remove('hidden');

    let remaining = 300;
    document.getElementById('share-timer').textContent = '05:00';

    shareTimerInterval = setInterval(() => {
        remaining--;
        const min = String(Math.floor(remaining/60)).padStart(2,'0');
        const sec = String(remaining%60).padStart(2,'0');
        document.getElementById('share-timer').textContent = `${min}:${sec}`;
        if (remaining <= 0) stopSharing();
    }, 1000);

    shareStream.getVideoTracks()[0].onended = () => {
        stopSharing();
    };
});

// Учитель принял демонстрацию — создаём WebRTC и отправляем поток
socket.on('share-accepted', async ({ teacherId }) => {
    if (!shareStream) return;
    console.log('[ONLINE] Учитель принял демонстрацию, создаём WebRTC...');

    if (sharePC) sharePC.close();
    sharePC = new RTCPeerConnection(iceConfig);

    shareStream.getTracks().forEach(track => sharePC.addTrack(track, shareStream));

    sharePC.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { target: teacherId, candidate: e.candidate, connectionType: 'share' });
        }
    };

    sharePC.onconnectionstatechange = () => {
        console.log('[ONLINE] Share connection:', sharePC.connectionState);
        if (sharePC.connectionState === 'failed' || sharePC.connectionState === 'disconnected') {
            stopSharing();
        }
    };

    const offer = await sharePC.createOffer();
    await sharePC.setLocalDescription(offer);
    socket.emit('offer', { target: teacherId, sdp: sharePC.localDescription, connectionType: 'share' });
});

// Обработка answer от учителя для нашего share PC
socket.on('answer', async ({ source, sdp }) => {
    if (sharePC) {
        try {
            await sharePC.setRemoteDescription(new RTCSessionDescription(sdp));
        } catch (err) {
            console.error('[ONLINE] Error setting answer:', err);
        }
    }
});

document.getElementById('stop-share-btn').addEventListener('click', stopSharing);

function stopSharing() {
    if (shareTimerInterval) {
        clearInterval(shareTimerInterval);
        shareTimerInterval = null;
    }
    if (shareStream) {
        shareStream.getTracks().forEach(t => t.stop());
        shareStream = null;
    }
    if (sharePC) {
        sharePC.close();
        sharePC = null;
    }
    
    socket.emit('online-user-stop-share');

    document.getElementById('share-screen-btn').classList.remove('hidden');
    document.getElementById('stop-share-btn').classList.add('hidden');
    document.getElementById('share-timer').classList.add('hidden');
}

socket.on('force-stop-sharing', stopSharing);
