let socket;

const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomIdInput = document.getElementById('roomIdInput');
const usernameInput = document.getElementById('usernameInput');
const rememberMeCheckbox = document.getElementById('rememberMe');
const videoEl = document.getElementById('video');
const studentVideo = document.getElementById('student-video');
const videoOverlayName = document.getElementById('video-overlay-name');

const qualitySelect = document.getElementById('qualitySelect');
const entryControls = document.getElementById('entry-controls');
const roomLayout = document.getElementById('room-layout');
const teacherControls = document.getElementById('teacher-controls');
const studentControls = document.getElementById('student-controls');
const roomInfo = document.getElementById('room-info');
const studentRoomInfo = document.getElementById('student-room-info');
const copyRoomIdBtn = document.getElementById('copyRoomIdBtn');
const btnDemo = document.getElementById('btn-demo');
const btnStopDemo = document.getElementById('btn-stop-demo');
const statusOverlay = document.getElementById('status-overlay');
const statusText = document.getElementById('status-text');
const teacherLeaveBtn = document.getElementById('teacherLeaveBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');

// Whiteboard elements
const whiteboard = document.getElementById('whiteboard');
const ctx = whiteboard.getContext('2d');
const whiteboardTools = document.getElementById('whiteboard-tools');
const colorPicker = document.getElementById('colorPicker');
const lineWidth = document.getElementById('lineWidth');
const clearCanvasBtn = document.getElementById('clearCanvasBtn');

let localStream;
const peerConnections = {};
let roomId;
let isTeacher = false;
let isBroadcasting = false;
let username = "User";

// Whiteboard state
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let currentTool = 'brush';

// Agent Control State
let currentViewedAgent = null;
let agentPeerConnection = null;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// --- Helper Functions ---

function log(msg) {
    console.log(msg);
}

function updateStatus(msg) {
    const overlay = document.getElementById('status-overlay');
    const text = document.getElementById('status-text');
    if (msg) {
        text.innerText = msg;
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function showStreamingView() {
    entryControls.classList.add('hidden');
    roomLayout.classList.remove('hidden');
    
    const topNavbar = document.getElementById('top-navbar');
    if (topNavbar) topNavbar.classList.remove('hidden');

    if (isTeacher) {
        const teacherTabs = document.getElementById('teacher-tabs');
        if (teacherTabs) teacherTabs.classList.remove('hidden');
        
        const agentsGrid = document.getElementById('agents-grid-container');
        if (agentsGrid) agentsGrid.classList.remove('hidden');
        
        const studioSidebar = document.getElementById('studio-sidebar');
        if (studioSidebar) studioSidebar.style.display = 'flex';

        document.getElementById('participants-section').classList.remove('hidden'); // Show participants
        teacherLeaveBtn.classList.remove('hidden');
        leaveRoomBtn.classList.add('hidden');
        roomInfo.innerText = roomId;
    } else {
        const studentVideo = document.getElementById('video-container-student');
        if (studentVideo) studentVideo.classList.remove('hidden');
        
        studentControls.classList.remove('hidden');
        teacherLeaveBtn.classList.add('hidden');
        leaveRoomBtn.classList.remove('hidden');
        studentRoomInfo.innerText = `Вы в комнате: ${roomId}`;
    }
    setupCanvas();
}

function showEntryView() {
    entryControls.classList.remove('hidden');
    roomLayout.classList.add('hidden');
    
    const topNavbar = document.getElementById('top-navbar');
    if (topNavbar) topNavbar.classList.add('hidden');

    const teacherTabs = document.getElementById('teacher-tabs');
    if (teacherTabs) teacherTabs.classList.add('hidden');
    
    const studioSidebar = document.getElementById('studio-sidebar');
    if (studioSidebar) studioSidebar.style.display = 'none';

    const agentsGrid = document.getElementById('agents-grid-container');
    if (agentsGrid) agentsGrid.classList.add('hidden');
    
    const whiteboardContainer = document.getElementById('whiteboard-container');
    if (whiteboardContainer) whiteboardContainer.classList.add('hidden');
    
    const studentVideo = document.getElementById('video-container-student');
    if (studentVideo) studentVideo.classList.add('hidden');

    studentControls.classList.add('hidden');
    document.getElementById('participants-section').classList.add('hidden');
    teacherLeaveBtn.classList.add('hidden');
    leaveRoomBtn.classList.add('hidden');
    
    stopLocalStream();
}

function updateParticipantsList(participants) {
    console.log("[DEBUG] updateParticipantsList called with:", participants);
    const list = document.getElementById('participants-list');
    const countSpan = document.getElementById('participant-count');
    const section = document.getElementById('participants-section');

    if (!list || !countSpan) {
        console.error("[DEBUG] Elements not found: list=", list, "countSpan=", countSpan);
        return;
    }

    // Show section if hidden (for teacher)
    if (isTeacher) {
        console.log("[DEBUG] Showing participants section for teacher");
        section.classList.remove('hidden');
        const rightSidebar = document.getElementById('right-sidebar');
        if (rightSidebar) rightSidebar.classList.remove('hidden');
    }

    list.innerHTML = '';
    countSpan.innerText = participants.length;

    if (participants.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 5px;">Нет участников</div>';
    } else {
        participants.forEach(p => {
            const div = document.createElement('div');
            div.className = 'participant-item';

            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

            const avatar = document.createElement('div');
            avatar.style.cssText = 'width: 24px; height: 24px; border-radius: 50%; background: var(--accent-color); display: flex; align-items: center; justify-content: center; color: white; font-size: 0.75rem; font-weight: bold;';
            avatar.textContent = p.name.charAt(0).toUpperCase();
            row.appendChild(avatar);

            const nameSpan = document.createElement('span');
            nameSpan.textContent = p.name;
            row.appendChild(nameSpan);

            div.appendChild(row);
            list.appendChild(div);
        });
    }
}

function updateAgentsList(agents) {
    const list = document.getElementById('agents-list');
    const countSpan = document.getElementById('agent-count');
    const section = document.getElementById('agents-grid-container');

    if (!list || !countSpan) return;

    if (isTeacher && section) {
        section.classList.remove('hidden');
    }

    list.innerHTML = '';
    countSpan.innerText = agents.length;

    if (agents.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 5px; grid-column: 1 / -1; text-align: center;">Нет доступных ПК</div>';
        return;
    }

    agents.forEach(agent => {
        const card = document.createElement('div');
        card.className = 'computer-card';
        card.onclick = () => viewAgent(agent.id, agent.name);

        const thumb = document.createElement('div');
        thumb.className = 'screen-thumbnail';
        thumb.textContent = '🖥️';
        card.appendChild(thumb);

        const pcName = document.createElement('div');
        pcName.className = 'pc-name';
        pcName.title = agent.name;
        pcName.textContent = agent.name;
        card.appendChild(pcName);

        const btn = document.createElement('button');
        btn.className = 'btn-connect';
        btn.textContent = 'Управление';
        card.appendChild(btn);

        list.appendChild(card);
    });
}

window.viewAgent = (agentId, agentName) => {
    currentViewedAgent = agentId;
    document.getElementById('agent-modal').classList.remove('hidden');
    document.getElementById('agent-modal-title').innerText = `Контроль ПК: ${agentName}`;
    document.getElementById('agentVideo').srcObject = null;
    socket.emit('request-agent-screen', agentId);
};

// --- Whiteboard Logic ---

        function setupCanvas() {
            const container = isTeacher ? document.getElementById('whiteboard-container') : document.getElementById('video-container-student');
            if (!container) return;

            const w = container.clientWidth;
            const h = container.clientHeight;
            if (w === 0 || h === 0) return; // Wait until container has size

            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            
            // Only draw if whiteboard already has valid dimensions
            if (whiteboard.width > 0 && whiteboard.height > 0) {
                tempCanvas.width = whiteboard.width;
                tempCanvas.height = whiteboard.height;
                tempCtx.drawImage(whiteboard, 0, 0);
            }

            const dpr = window.devicePixelRatio || 1;
            whiteboard.width = w * dpr;
            whiteboard.height = h * dpr;
            ctx.scale(dpr, dpr);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (tempCanvas.width > 0 && tempCanvas.height > 0) {
                ctx.drawImage(tempCanvas, 0, 0, whiteboard.width / dpr, whiteboard.height / dpr);
            }
        }

        function drawOnCanvas(x0, y0, x1, y1, color, width, emit, tool = 'brush') {
            ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.strokeStyle = tool === 'eraser' ? 'rgba(0,0,0,1)' : color;
            ctx.lineWidth = width;
            ctx.stroke();
            ctx.closePath();
            ctx.globalCompositeOperation = 'source-over';

            if (!emit) return;

            const w = whiteboard.width / (window.devicePixelRatio || 1);
            const h = whiteboard.height / (window.devicePixelRatio || 1);

            socket.emit('draw', {
                x0: x0 / w,
                y0: y0 / h,
                x1: x1 / w,
                y1: y1 / h,
                color: color,
                width: width,
                tool: tool,
                image: whiteboard.toDataURL()
            });
        }

        function handleDrawing(e) {
            if (!isDrawing || !isTeacher) return;
            const rect = whiteboard.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;
            drawOnCanvas(lastX, lastY, currentX, currentY, colorPicker.value, lineWidth.value, true, currentTool);
            lastX = currentX;
            lastY = currentY;
        }

        function clearCanvas() {
            const dpr = window.devicePixelRatio || 1;
            ctx.clearRect(0, 0, whiteboard.width / dpr, whiteboard.height / dpr);
        }

        window.addEventListener('resize', setupCanvas);

        whiteboard.addEventListener('mousedown', (e) => {
            if (!isTeacher) return;
            isDrawing = true;
            const rect = whiteboard.getBoundingClientRect();
            [lastX, lastY] = [e.clientX - rect.left, e.clientY - rect.top];
        });
        whiteboard.addEventListener('mousemove', handleDrawing);
        whiteboard.addEventListener('mouseup', () => isDrawing = false);
        whiteboard.addEventListener('mouseout', () => isDrawing = false);

        clearCanvasBtn.addEventListener('click', () => {
            if (!isTeacher) return;
            log("Очистка доски");
            clearCanvas();
            log("Отправка события 'clear-canvas' на сервер");
            socket.emit('clear-canvas');
        });

        // --- Media Logic ---

        function stopLocalStream() {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
                videoEl.srcObject = null;
            }
        }

        async function startLocalStream() {
            if (localStream) return true;

            try {
                updateStatus('Запрашиваем доступ к экрану...');
                const selectedQuality = qualitySelect.value;
                const fpsInput = document.getElementById('selectedFps');
                const targetFps = fpsInput ? parseInt(fpsInput.value, 10) : 30;
                const [width, height] = selectedQuality.split('x').map(Number);

                const displayMediaOptions = {
                    video: {
                        width: { ideal: width, max: width },
                        height: { ideal: height, max: height },
                        frameRate: { ideal: targetFps, max: targetFps }
                    },
                    audio: true
                };
                localStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
                videoEl.srcObject = localStream;
                updateStatus(null);
                return true;
            } catch (error) {
                updateStatus(null);
                console.error("Ошибка при захвате экрана:", error);
                alert("Не удалось получить доступ к экрану. Убедитесь, что вы дали разрешение.");
                return false;
            }
        }

        // --- Socket Logic ---

        function initializeSocket(isStudent) {
            log('Инициализация нового сокет-соединения...');
            if (socket) {
                socket.disconnect();
            }
            socket = io();

            setupSocketListeners();

            socket.on('connect', () => {
                log(`[CLIENT] Событие 'connect' сработало. ID сокета: ${socket.id}`);
                if (isStudent) {
                    log("Отправка события 'request-room-state' на сервер");
                    socket.emit('request-room-state', roomId, username);
                } else {
                    log(`Отправка события 'register-teacher' на сервер`);
                    socket.emit('register-teacher', roomId, username);
                    socket.emit('request-agents-list'); // Запрашиваем список агентов сразу
                    showStreamingView();
                    isBroadcasting = false;
                    updateStatus(null);
                }
            });
        }

        function setupSocketListeners() {
            socket.on('room-state', (state) => {
                if (state.error) {
                    alert(state.error);
                    showEntryView();
                    return;
                }
                isBroadcasting = state.isBroadcasting;
                log("Отправка события 'join-room' на сервер");
                socket.emit('join-room', roomId, username);
                showStreamingView();

                if (state.teacherName) {
                    videoOverlayName.innerText = state.teacherName;
                    videoOverlayName.classList.remove('hidden');
                }

                if (state.canvasState) {
                    const img = new Image();
                    img.onload = () => {
                        ctx.drawImage(img, 0, 0, whiteboard.width / (window.devicePixelRatio || 1), whiteboard.height / (window.devicePixelRatio || 1));
                    };
                    img.src = state.canvasState;
                }

                if (isBroadcasting) {
                    updateStatus('Трансляция идет. Ожидаем подключения...');
                } else {
                    // Не блокируем экран, если трансляция еще не началась, чтобы ученик видел доску
                    updateStatus(null);
                    studentRoomInfo.innerText = `Вы в комнате: ${roomId}. Трансляция пока не началась.`;
                }
            });

            socket.on('broadcast-started', () => {
                log("[CLIENT] Получено событие 'broadcast-started' от сервера");
                if (isTeacher) return;
                studentRoomInfo.innerText = `Вы в комнате: ${roomId}. Трансляция началась!`;
                updateStatus('Учитель начал трансляцию. Подключаемся...');
            });

            socket.on('initiate-peer-connections', (students) => {
                log(`[CLIENT] -> ПОЛУЧЕН сигнал 'initiate-peer-connections'. Студентов: ${students.length}`);
                students.forEach(student => {
                    connectToUser(student.id);
                });
            });

            socket.on('initiate-single-connection', (studentId, studentName) => {
                log(`[CLIENT] -> ПОЛУЧЕН сигнал 'initiate-single-connection' для ученика: ${studentName || studentId}`);

                const info = document.createElement('div');
                info.innerText = `Подключился ученик: ${studentName || studentId}`;
                info.style.cssText = "background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 5px; margin-top: 5px; border-radius: 4px; font-size: 0.8rem;";
                teacherControls.appendChild(info);
                setTimeout(() => info.remove(), 5000);

                if (isTeacher && localStream) {
                    connectToUser(studentId);
                }
            });

            socket.on('draw', (data) => {
                const w = whiteboard.width / (window.devicePixelRatio || 1);
                const h = whiteboard.height / (window.devicePixelRatio || 1);
                drawOnCanvas(data.x0 * w, data.y0 * h, data.x1 * w, data.y1 * h, data.color, data.width, false, data.tool || 'brush');
            });

            socket.on('clear-canvas', clearCanvas);

            socket.on('broadcast-stopped', () => {
                log("[CLIENT] Получено событие 'broadcast-stopped' от сервера");
                isBroadcasting = false;
                updateStatus('Трансляция завершена учителем.');
                if (videoEl) videoEl.srcObject = null;
                if (studentVideo) studentVideo.srcObject = null;
                if (videoOverlayName) videoOverlayName.classList.add('hidden');
                clearCanvas();

                if (!isTeacher) {
                    studentRoomInfo.innerText = `Вы в комнате: ${roomId}. Трансляция завершена.`;
                }
            });

            socket.on('update-participants', (participants) => {
                log(`[CLIENT] Получен список участников: ${participants.length}`);
                updateParticipantsList(participants);
            });

            socket.on('update-agents-list', (agents) => {
                if (isTeacher) {
                    updateAgentsList(agents);
                }
            });

            socket.on('offer', async (payload) => {
                if (isTeacher) {
                    // Это может быть оффер от Агента!
                    if (currentViewedAgent === payload.source) {
                        log(`[CLIENT] Получен 'offer' от Агента ${payload.source}`);
                        const pc = new RTCPeerConnection(configuration);
                        agentPeerConnection = pc;
                        
                        pc.ontrack = (event) => {
                            document.getElementById('agentVideo').srcObject = event.streams[0];
                        };
                        pc.onicecandidate = (event) => {
                            if (event.candidate) socket.emit('ice-candidate', { target: payload.source, candidate: event.candidate });
                        };
                        
                        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        socket.emit('answer', { target: payload.source, sdp: pc.localDescription });
                    }
                    return;
                }

                const pc = new RTCPeerConnection(configuration);
                log(`[CLIENT] -> ПОЛУЧЕН 'offer' от ${payload.source}.`);
                peerConnections[payload.source] = pc;

                pc.onconnectionstatechange = () => {
                    log(`Статус соединения с учителем ${payload.source}: ${pc.connectionState}.`);
                    if (pc.connectionState === 'connecting' || (pc.connectionState === 'connected' && !videoEl.srcObject)) {
                        updateStatus('Соединение установлено. Ожидание видео...');
                    } else if (pc.connectionState === 'failed') {
                        updateStatus('Ошибка подключения.');
                    }
                };

                pc.ontrack = (event) => {
                    log(`-> ПОЛУЧЕН видеопоток (ontrack) от ${payload.source}`);
                    if (!isTeacher && studentVideo) {
                        studentVideo.srcObject = event.streams[0];
                    } else if (isTeacher && videoEl) {
                        videoEl.srcObject = event.streams[0];
                    }
                    updateStatus(null);
                };

                pc.onicecandidate = (event) => {
                    if (event.candidate) {
                        socket.emit('ice-candidate', { target: payload.source, candidate: event.candidate });
                    }
                };

                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('answer', { target: payload.source, sdp: pc.localDescription });
            });

            socket.on('answer', async (payload) => {
                log(`[CLIENT] -> ПОЛУЧЕН 'answer' от ${payload.source}`);
                const pc = peerConnections[payload.source] || (currentViewedAgent === payload.source ? agentPeerConnection : null);
                if (pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                }
            });

            socket.on('ice-candidate', async (payload) => {
                const pc = peerConnections[payload.source] || (currentViewedAgent === payload.source ? agentPeerConnection : null);
                if (pc) {
                    await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
                }
            });

            socket.on('user-disconnected', (userId) => {
                if (isTeacher && peerConnections[userId]) {
                    log(`Ученик ${userId} отключился.`);
                    peerConnections[userId].close();
                    delete peerConnections[userId];
                }
                else if (!isTeacher && peerConnections[userId]) {
                    log(`Учитель ${userId} отключился.`);
                    peerConnections[userId].close();
                    delete peerConnections[userId];
                    updateStatus('Трансляция завершена учителем.');
                    setTimeout(() => {
                        showEntryView();
                    }, 4000);
                }
            });
        }

        async function connectToUser(userId) {
            log(`connectToUser: Начинаю подключение к ${userId}`);
            if (!localStream) {
                log(`[ОШИБКА] Нет localStream.`);
                return;
            }
            const pc = new RTCPeerConnection(configuration);
            peerConnections[userId] = pc;

            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { target: userId, sdp: pc.localDescription });

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', { target: userId, candidate: event.candidate });
                }
            };
        }

        // --- UI Event Listeners ---

        function handleUsernameSave() {
            const name = usernameInput.value.trim();
            if (rememberMeCheckbox.checked) {
                localStorage.setItem('streamhub_username', name);
                localStorage.setItem('streamhub_remember', 'true');
            } else {
                localStorage.removeItem('streamhub_username');
                localStorage.removeItem('streamhub_remember');
            }
            return name;
        }

        window.addEventListener('load', () => {
            const savedName = localStorage.getItem('streamhub_username');
            const shouldRemember = localStorage.getItem('streamhub_remember');
            if (savedName && shouldRemember === 'true') {
                usernameInput.value = savedName;
                rememberMeCheckbox.checked = true;
            }
        });

        window.onerror = function (msg, url, lineNo, columnNo, error) {
            alert('Error: ' + msg + ' Line: ' + lineNo);
            return false;
        };
        
        // Agent UI Event Listeners
        const closeAgentModalBtn = document.getElementById('closeAgentModalBtn');
        if (closeAgentModalBtn) {
            closeAgentModalBtn.addEventListener('click', () => {
                document.getElementById('agent-modal').classList.add('hidden');
                currentViewedAgent = null;
                if (agentPeerConnection) {
                    agentPeerConnection.close();
                    agentPeerConnection = null;
                }
                document.getElementById('agentVideo').srcObject = null;
            });
        }

        const agentCatcher = document.getElementById('agent-mouse-catcher');
        if (agentCatcher) {
            let lastMoveTime = 0;
            
            function sendMouseData(action, e) {
                if (!currentViewedAgent) return;
                
                // Throttling: Ограничиваем только движение (до 30 кадров в секунду), чтобы не перегружать сеть
                if (action === 'move') {
                    const now = Date.now();
                    if (now - lastMoveTime < 33) return; // 33мс = ~30 FPS
                    lastMoveTime = now;
                }
                
                // Нормализация координат
                let clientX = e.clientX;
                let clientY = e.clientY;
                
                if (e.touches && e.touches.length > 0) {
                    clientX = e.touches[0].clientX;
                    clientY = e.touches[0].clientY;
                }

                // При touchend координаты обычно пропадают, но нам важен сам экшен
                if (e.type === 'touchend' || e.type === 'mouseup') {
                     // Просто отправляем действие без жесткой привязки к x,y 
                     // (Агент нажмет кнопку отпускания там, где мышь уже находится)
                     socket.emit('remote-mouse', { target: currentViewedAgent, data: { action } });
                     return;
                }

                const rect = e.target.getBoundingClientRect();
                const x = (clientX - rect.left) / rect.width;
                const y = (clientY - rect.top) / rect.height;
                
                if(x < 0 || x > 1 || y < 0 || y > 1) return;

                socket.emit('remote-mouse', { target: currentViewedAgent, data: { action, x, y } });
            }

            // Классическая мышь
            agentCatcher.addEventListener('mousemove', (e) => sendMouseData('move', e));
            agentCatcher.addEventListener('mousedown', (e) => sendMouseData('mousedown', e));
            agentCatcher.addEventListener('mouseup', (e) => sendMouseData('mouseup', e));
            
            // Смартфоны (Touch)
            agentCatcher.addEventListener('touchmove', (e) => { e.preventDefault(); sendMouseData('move', e); }, { passive: false });
            agentCatcher.addEventListener('touchstart', (e) => { e.preventDefault(); sendMouseData('mousedown', e); }, { passive: false });
            agentCatcher.addEventListener('touchend', (e) => { e.preventDefault(); sendMouseData('mouseup', e); }, { passive: false });

            // Скроллинг колесиком мыши (и свайпами двумя пальцами на тачпадах/смартфонах)
            agentCatcher.addEventListener('wheel', (e) => {
                e.preventDefault();
                if (!currentViewedAgent) return;
                // Направление прокрутки
                socket.emit('remote-scroll', { target: currentViewedAgent, data: { deltaY: e.deltaY } });
            }, { passive: false });
        }

        // Перехват клавиатуры
        document.addEventListener('keydown', (e) => {
            const agentModal = document.getElementById('agent-modal');
            // Перехватываем ввод ТОЛЬКО тогда, когда окно Агента открыто
            if (agentModal && !agentModal.classList.contains('hidden') && currentViewedAgent) {
                // Игнорируем F5 (обновление) и F12
                if (e.key !== 'F5' && e.key !== 'F12' && !(e.ctrlKey && e.key === 'r')) {
                    e.preventDefault(); // Запрещаем браузеру прокрутку пробелом и шорткаты
                    socket.emit('remote-keyboard', { target: currentViewedAgent, data: { key: e.key } });
                }
            }
        }, { passive: false });

        createRoomBtn.addEventListener('click', () => {
            console.log("Create Room Clicked");
            if (!usernameInput.value.trim()) {
                alert("Пожалуйста, введите ваше имя.");
                return;
            }
            username = handleUsernameSave();
            isTeacher = true;
            roomId = generateRoomId();
            if (typeof io === 'undefined') {
                alert("Ошибка: Сервер недоступен (socket.io не загружен).");
                return;
            }
            initializeSocket(false);
        });

        joinRoomBtn.addEventListener('click', () => {
            roomId = roomIdInput.value.trim();
            if (!usernameInput.value.trim()) {
                alert("Пожалуйста, введите ваше имя.");
                return;
            }
            if (!roomId) {
                alert("Пожалуйста, введите ID комнаты.");
                return;
            }
            username = handleUsernameSave();
            isTeacher = false;
            updateStatus('Подключение к комнате...');
            initializeSocket(true);
        });

        // Tab Switching Logic
        const tabMonitoring = document.getElementById('tab-monitoring');
        const tabWhiteboard = document.getElementById('tab-whiteboard');
        
        if (tabMonitoring && tabWhiteboard) {
            tabMonitoring.addEventListener('click', () => {
                if (!isTeacher) return;
                tabMonitoring.classList.add('active');
                tabWhiteboard.classList.remove('active');
                
                document.getElementById('agents-grid-container').classList.remove('hidden');
                document.getElementById('whiteboard-container').classList.add('hidden');
                document.getElementById('whiteboard-tools').classList.add('hidden');
            });

            tabWhiteboard.addEventListener('click', () => {
                if (!isTeacher) return;
                tabWhiteboard.classList.add('active');
                tabMonitoring.classList.remove('active');
                
                document.getElementById('whiteboard-container').classList.remove('hidden');
                document.getElementById('agents-grid-container').classList.add('hidden');
                document.getElementById('whiteboard-tools').classList.remove('hidden');
                setupCanvas();
            });
        }

        // Whiteboard Tool Buttons (Brush vs Eraser)
        const toolBrushBtn = document.getElementById('toolBrushBtn');
        const toolEraserBtn = document.getElementById('toolEraserBtn');
        const brushColorWrapper = document.getElementById('brushColorWrapper');

        if (toolBrushBtn && toolEraserBtn) {
            toolBrushBtn.addEventListener('click', () => {
                currentTool = 'brush';
                toolBrushBtn.style.background = 'var(--primary-color)';
                toolBrushBtn.style.border = 'none';
                toolEraserBtn.style.background = 'rgba(255,255,255,0.1)';
                toolEraserBtn.style.border = '1px solid var(--border-color)';
                if (brushColorWrapper) brushColorWrapper.style.display = 'flex';
            });
            toolEraserBtn.addEventListener('click', () => {
                currentTool = 'eraser';
                toolEraserBtn.style.background = 'rgba(255,255,255,0.2)';
                toolEraserBtn.style.border = '1px solid var(--primary-color)';
                toolBrushBtn.style.background = 'rgba(255,255,255,0.1)';
                toolBrushBtn.style.border = '1px solid var(--border-color)';
                if (brushColorWrapper) brushColorWrapper.style.display = 'none';
            });
        }

        // FPS Selection Buttons
        const fps30Btn = document.getElementById('fps30Btn');
        const fps60Btn = document.getElementById('fps60Btn');
        const selectedFps = document.getElementById('selectedFps');

        if (fps30Btn && fps60Btn && selectedFps) {
            fps30Btn.addEventListener('click', () => {
                selectedFps.value = '30';
                fps30Btn.classList.add('active');
                fps30Btn.style.background = 'var(--primary-color)';
                fps30Btn.style.color = 'white';
                
                fps60Btn.classList.remove('active');
                fps60Btn.style.background = 'transparent';
                fps60Btn.style.color = 'var(--text-muted)';
            });

            fps60Btn.addEventListener('click', () => {
                selectedFps.value = '60';
                fps60Btn.classList.add('active');
                fps60Btn.style.background = 'var(--primary-color)';
                fps60Btn.style.color = 'white';

                fps30Btn.classList.remove('active');
                fps30Btn.style.background = 'transparent';
                fps30Btn.style.color = 'var(--text-muted)';
            });
        }

        if (btnDemo) {
            btnDemo.addEventListener('click', async () => {
                const streamStarted = await startLocalStream();
                if (!streamStarted) return;

                isBroadcasting = true;
                socket.emit('start-broadcast', roomId);
                socket.emit('initiate-connections', roomId);

                // Show Stop button, hide Start
                if (btnDemo) btnDemo.classList.add('hidden');
                if (btnStopDemo) btnStopDemo.classList.remove('hidden');
                
                // Show Demonstration settings
                const demoSettings = document.getElementById('demo-settings');
                if (demoSettings) demoSettings.classList.remove('hidden');
            });
        }

        if (btnStopDemo) {
            btnStopDemo.addEventListener('click', () => {
                stopLocalStream();
                isBroadcasting = false;
                socket.emit('stop-broadcast', roomId);
                
                // Show Start, hide Stop
                if (btnDemo) btnDemo.classList.remove('hidden');
                if (btnStopDemo) btnStopDemo.classList.add('hidden');
                
                // Hide Demonstration Settings
                const demoSettings = document.getElementById('demo-settings');
                if (demoSettings) demoSettings.classList.add('hidden');
            });
        }

        qualitySelect.addEventListener('change', async () => {
            if (!isTeacher || !localStream) return;
            try {
                const selectedQuality = qualitySelect.value;
                const [width, height] = selectedQuality.split('x').map(Number);
                const videoTrack = localStream.getVideoTracks()[0];
                if (!videoTrack) return;
                updateStatus(`Изменение качества на ${height}p...`);
                await videoTrack.applyConstraints({
                    width: { ideal: width, max: width },
                    height: { ideal: height, max: height },
                });
                updateStatus(null);
            } catch (error) {
                console.error("Ошибка качества:", error);
                updateStatus(null);
            }
        });

        copyRoomIdBtn.addEventListener('click', () => {
            if (!roomId) return;
            navigator.clipboard.writeText(roomId).then(() => {
                const originalHTML = copyRoomIdBtn.innerHTML;
                copyRoomIdBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                copyRoomIdBtn.disabled = true;
                setTimeout(() => {
                    copyRoomIdBtn.innerHTML = originalHTML;
                    copyRoomIdBtn.disabled = false;
                }, 1500);
            });
        });

        function leaveRoom() {
            whiteboardTools.classList.add('hidden');
            stopLocalStream();
            Object.values(peerConnections).forEach(pc => pc.close());
            for (const key in peerConnections) delete peerConnections[key];

            if (isTeacher) {
                socket.emit('leave-room', roomId);
            } else {
                socket.disconnect();
            }
            showEntryView();
            isBroadcasting = false;
        }

        teacherLeaveBtn.addEventListener('click', leaveRoom);
        leaveRoomBtn.addEventListener('click', leaveRoom);
