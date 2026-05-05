const socket = io();
let myName = '';
let shareStream = null;
let shareTimerInterval = null;
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
    div.appendChild(document.createTextNode(' 📎 '));
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
    document.getElementById('waiting-msg').textContent = 'Подключение к трансляции...';
    showToast('Учитель начал трансляцию', 'info');
});

socket.on('broadcast-stopped', () => {
    console.log('[ONLINE] Broadcast stopped');
    if (teacherPC) {
        teacherPC.close();
        teacherPC = null;
    }
    document.getElementById('teacher-video').srcObject = null;
    document.getElementById('waiting-msg').textContent = 'Ожидание демонстрации учителя...';
    document.getElementById('waiting-msg').classList.remove('hidden');
    showToast('Трансляция учителя остановлена', 'info');
});

socket.on('teacher-disconnected', () => {
    console.log('[ONLINE] Учитель отключился');
    document.getElementById('waiting-msg').textContent = 'Учитель отключился. Ожидание переподключения...';
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
            socket.emit('ice-candidate', { target: source, candidate: e.candidate }); 
        }
    };

    teacherPC.onconnectionstatechange = () => {
        console.log('[ONLINE] Connection state:', teacherPC.connectionState);
    };
    
    await teacherPC.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await teacherPC.createAnswer();
    await teacherPC.setLocalDescription(answer);
    socket.emit('answer', { target: source, sdp: teacherPC.localDescription });
});

// WebRTC: handle ICE candidates from teacher
socket.on('ice-candidate', async ({ source, candidate }) => {
    console.log('[ONLINE] Received ICE candidate from', source);
    if (teacherPC) {
        try {
            await teacherPC.addIceCandidate(candidate);
        } catch (err) {
            console.error('[ONLINE] Error adding ICE candidate:', err);
        }
    }
});

// --- ДОСКА ---
const canvas = document.getElementById('teacher-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    const rect = document.getElementById('video-area').getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width;
    canvas.height = rect.height;
}
window.addEventListener('resize', resizeCanvas);

// Whiteboard mode toggle from teacher
socket.on('whiteboard-mode', (active) => {
    console.log('[ONLINE] Whiteboard mode:', active);
    if (active) {
        // Show white canvas background for whiteboard
        document.getElementById('waiting-msg').classList.add('hidden');
        canvas.style.background = 'white';
        canvas.style.pointerEvents = 'none';
        resizeCanvas();
    } else {
        // Return to normal (video/waiting)
        canvas.style.background = 'transparent';
        if (!document.getElementById('teacher-video').srcObject) {
            document.getElementById('waiting-msg').classList.remove('hidden');
        }
        // Clear any whiteboard drawings
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
});

// --- ПОКАЗ СВОЕГО ЭКРАНА (5 минут) ---
document.getElementById('share-screen-btn').addEventListener('click', async () => {
    try {
        shareStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch (e) { 
        console.error('Screen sharing canceled or failed', e);
        return; 
    }

    socket.emit('online-user-share-screen', { userId: socket.id });

    // Show timer
    document.getElementById('share-screen-btn').classList.add('hidden');
    document.getElementById('stop-share-btn').classList.remove('hidden');
    document.getElementById('share-timer').classList.remove('hidden');

    let remaining = 300; // 5 minutes
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
    
    socket.emit('online-user-stop-share', { userId: socket.id });

    document.getElementById('share-screen-btn').classList.remove('hidden');
    document.getElementById('stop-share-btn').classList.add('hidden');
    document.getElementById('share-timer').classList.add('hidden');
}

socket.on('force-stop-sharing', stopSharing);
