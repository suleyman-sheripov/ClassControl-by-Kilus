const { ipcRenderer } = require('electron');
const io = require('socket.io-client');

const serverUrlInput = document.getElementById('serverUrl');
const pcNameInput = document.getElementById('pcName');
const roomIdInput = document.getElementById('roomId');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const statusBox = document.getElementById('statusBox');

let socket;
let localStream;
const peerConnections = {}; 
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Load settings from localStorage when the app starts
window.onload = () => {
    serverUrlInput.value = localStorage.getItem('agentSettings_serverUrl') || 'http://localhost:3000';
    pcNameInput.value = localStorage.getItem('agentSettings_pcName') || `Рабочий ПК-${Math.floor(Math.random()*100)}`;
    roomIdInput.value = localStorage.getItem('agentSettings_roomId') || 'SCHOOL';
};

function setStatus(text, isConnected) {
    statusBox.innerText = `Статус: ${text}`;
    statusBox.className = `status ${isConnected ? 'connected' : 'disconnected'}`;
}

function handleConnect() {
    const url = serverUrlInput.value.trim();
    const pcName = pcNameInput.value.trim();
    const roomId = roomIdInput.value.trim();

    if (!url || !pcName || !roomId) {
        alert("Заполните все поля для подключения!");
        return;
    }

    // Сохраняем в память
    localStorage.setItem('agentSettings_serverUrl', url);
    localStorage.setItem('agentSettings_pcName', pcName);
    localStorage.setItem('agentSettings_roomId', roomId);

    setStatus('Подключение к серверу...', false);
    
    if (socket) socket.disconnect();
    
    // Создаем новое подключение к указанному URL
    socket = io(url);
    setupSocketListeners(socket, pcName, roomId);
    
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'block';
    serverUrlInput.disabled = true;
    pcNameInput.disabled = true;
    roomIdInput.disabled = true;
}

function handleDisconnect() {
    if (socket) socket.disconnect();
    setStatus('Отключен пользователем', false);
    connectBtn.style.display = 'block';
    disconnectBtn.style.display = 'none';
    
    serverUrlInput.disabled = false;
    pcNameInput.disabled = false;
    roomIdInput.disabled = false;
}

connectBtn.addEventListener('click', handleConnect);
disconnectBtn.addEventListener('click', handleDisconnect);


function setupSocketListeners(s_socket, pcName, roomId) {
    s_socket.on('connect', () => {
        setStatus(`В сети (${s_socket.id})`, true);
        s_socket.emit('register-agent', roomId, pcName);
    });

    s_socket.on('disconnect', () => {
        setStatus('Связь с сервером потеряна...', false);
    });

    s_socket.on('teacher-request-screen', async (teacherId) => {
        console.log('Учитель запросил трансляцию экрана!');
        const source = await ipcRenderer.invoke('get-desktop-source');
        
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: source.id,
                        minWidth: 1280, maxWidth: 1280,
                        minHeight: 720, maxHeight: 720
                    }
                }
            });
            connectToTeacher(teacherId, s_socket);
        } catch (e) {
            console.error("Ошибка захвата экрана:", e);
        }
    });

    s_socket.on('answer', async (payload) => {
        const pc = peerConnections[payload.source];
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    });

    s_socket.on('ice-candidate', async (payload) => {
        const pc = peerConnections[payload.source];
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    });

    s_socket.on('remote-mouse', (data) => {
        ipcRenderer.send('mouse-move', data);
    });

    s_socket.on('remote-scroll', (data) => {
        ipcRenderer.send('scroll-action', data);
    });

    s_socket.on('remote-keyboard', (data) => {
        ipcRenderer.send('keyboard-action', data);
    });
}

async function connectToTeacher(teacherId, s_socket) {
    const pc = new RTCPeerConnection(configuration);
    peerConnections[teacherId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    s_socket.emit('offer', { target: teacherId, sdp: pc.localDescription });

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            s_socket.emit('ice-candidate', { target: teacherId, candidate: event.candidate });
        }
    };
}
