const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 3000;
const UDP_PORT = 41234;

// --- Состояние сервера (в памяти) ---
let teacherSocket = null;
let teacherName = '';
let agents = {};                // { socketId: { id, name, ip } }
let onlineUsers = {};           // { socketId: { id, name } }
let isBroadcasting = false;
let canvasState = null;         // Последнее состояние доски (DataURL)
let chatHistory = [];           // Массив сообщений чата (макс 200)

// --- Настройка Multer (загрузка файлов) ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } 
});

// --- Express Middleware & Static ---
app.use(express.static(path.join(__dirname, '../online')));
app.use('/files', express.static(path.join(__dirname, 'uploads')));

// Маршрут для загрузки файлов через чат
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    
    const fileInfo = {
        filename: req.file.originalname,
        url: `/files/${req.file.filename}`,
        size: req.file.size,
        timestamp: Date.now(),
        sender: req.body.sender || 'Unknown'
    };
    
    io.emit('chat-file', fileInfo);
    chatHistory.push({ type: 'file', ...fileInfo });
    if (chatHistory.length > 200) chatHistory.shift();
    
    res.json(fileInfo);
});

// --- Socket.IO Логика ---
io.on('connection', (socket) => {
    console.log(`[SERVER] Новое подключение: ${socket.id}`);

    // Регистрирация учителя
    socket.on('register-teacher', (roomId, username) => {
        teacherSocket = socket;
        teacherName = username;
        console.log(`[SERVER] Учитель зарегистрирован: ${username}`);
        
        socket.emit('agents-list', Object.values(agents));
        socket.emit('online-users-list', Object.values(onlineUsers));
        socket.emit('chat-history', chatHistory);
    });

    // Регистрация локального агента (ПК в классе)
    socket.on('register-agent', (agentName) => {
        agents[socket.id] = { 
            id: socket.id, 
            name: agentName,
            ip: socket.handshake.address 
        };
        console.log(`[SERVER] Агент зарегистрирован: ${agentName} (${socket.id})`);
        
        if (teacherSocket) {
            teacherSocket.emit('agents-list', Object.values(agents));
        }
    });

    // Регистрация онлайн-участника (из дома)
    socket.on('register-online-user', (username) => {
        onlineUsers[socket.id] = { id: socket.id, name: username };
        console.log(`[SERVER] Онлайн-пользователь вошел: ${username}`);
        
        if (teacherSocket) {
            teacherSocket.emit('online-users-list', Object.values(onlineUsers));
        }
        
        socket.emit('chat-history', chatHistory);
        if (isBroadcasting) socket.emit('broadcast-started');
        if (canvasState) socket.emit('canvas-state', canvasState);
    });

    // Мониторинг: получение скриншота от агента
    socket.on('agent-screenshot', (data) => {
        if (teacherSocket) {
            teacherSocket.emit('agent-screenshot', data);
        }
    });

    socket.on('request-agents-list', () => {
        socket.emit('agents-list', Object.values(agents));
    });

    // Демонстрация (Broadcast)
    socket.on('start-broadcast', () => {
        isBroadcasting = true;
        socket.broadcast.emit('broadcast-started');
        console.log('[SERVER] Трансляция началась');
        
        // Учитель должен начать создавать PeerConnections
        // Мы отправляем ему список всех, кто должен смотреть
        const viewers = [
            ...Object.keys(agents),
            ...Object.keys(onlineUsers)
        ].filter(id => id !== socket.id);
        
        socket.emit('initiate-peer-connections', viewers.map(id => ({ id })));
    });

    socket.on('stop-broadcast', () => {
        isBroadcasting = false;
        socket.broadcast.emit('broadcast-stopped');
        console.log('[SERVER] Трансляция остановлена');
    });

    // WebRTC Сигналинг
    socket.on('offer', (data) => {
        io.to(data.target).emit('offer', { source: socket.id, sdp: data.sdp });
    });

    socket.on('answer', (data) => {
        io.to(data.target).emit('answer', { source: socket.id, sdp: data.sdp });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.target).emit('ice-candidate', { source: socket.id, candidate: data.candidate });
    });

    // Онлайн-доска
    socket.on('draw', (data) => {
        if (data.image) canvasState = data.image;
        socket.broadcast.emit('draw', data);
    });

    socket.on('clear-canvas', () => {
        canvasState = null;
        socket.broadcast.emit('clear-canvas');
    });

    // Whiteboard mode toggle (teacher switches tabs)
    socket.on('whiteboard-mode', (active) => {
        socket.broadcast.emit('whiteboard-mode', active);
    });

    // Чат
    socket.on('chat-message', (data) => {
        // Санитизация от XSS
        const sanitize = (str) => String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const msg = { 
            sender: sanitize(data.sender), 
            text: sanitize(data.text), 
            timestamp: Date.now() 
        };
        chatHistory.push(msg);
        if (chatHistory.length > 200) chatHistory.shift();
        io.emit('chat-message', msg);
    });

    // Запрос истории чата (для окна чата агента)
    socket.on('request-chat-history', () => {
        socket.emit('chat-history', chatHistory);
    });

    // Удаленное управление агентом
    socket.on('request-agent-screen', (agentId) => {
        io.to(agentId).emit('request-screen-share');
    });

    socket.on('agent-control', (data) => {
        io.to(data.agentId).emit('control-command', { 
            action: data.action, 
            data: data.data 
        });
    });

    // Демонстрация онлайн-участника (добровольная)
    socket.on('online-user-share-screen', (data) => {
        if (teacherSocket) {
            teacherSocket.emit('online-user-sharing', { 
                userId: socket.id, 
                name: onlineUsers[socket.id]?.name 
            });
        }
    });

    socket.on('online-user-stop-share', (data) => {
        if (teacherSocket) {
            teacherSocket.emit('online-user-stopped-sharing', { userId: socket.id });
        }
    });

    socket.on('teacher-close-share', (data) => {
        io.to(data.userId).emit('force-stop-sharing');
    });

    // Отключение
    socket.on('disconnect', () => {
        console.log(`[SERVER] Отключение: ${socket.id}`);
        
        if (socket === teacherSocket) {
            teacherSocket = null;
            isBroadcasting = false;
            console.log('[SERVER] Учитель отключился');
        } else if (agents[socket.id]) {
            console.log(`[SERVER] Агент отключился: ${agents[socket.id].name}`);
            delete agents[socket.id];
            if (teacherSocket) teacherSocket.emit('agents-list', Object.values(agents));
        } else if (onlineUsers[socket.id]) {
            console.log(`[SERVER] Онлайн-пользователь отключился: ${onlineUsers[socket.id].name}`);
            delete onlineUsers[socket.id];
            if (teacherSocket) teacherSocket.emit('online-users-list', Object.values(onlineUsers));
        }
    });
});

// --- LAN Discovery (UDP Broadcast) ---
const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
udpServer.on('message', (msg, rinfo) => {
    if (msg.toString() === 'CLASSCONTROL_DISCOVER') {
        const interfaces = os.networkInterfaces();
        let localIP = '127.0.0.1';
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    localIP = iface.address;
                    break;
                }
            }
            if (localIP !== '127.0.0.1') break;
        }
        
        const response = Buffer.from(`CLASSCONTROL_SERVER:${localIP}:${PORT}`);
        udpServer.send(response, rinfo.port, rinfo.address, (err) => {
            if (err) console.error('[UDP] Ошибка отправки ответа:', err);
        });
    }
});

udpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[UDP] Port ${UDP_PORT} already in use. Discovery disabled.`);
    } else {
        console.error(`[UDP] Error:`, err.message);
    }
    try { udpServer.close(); } catch(e) {}
});

try {
    udpServer.bind(UDP_PORT, () => {
        console.log(`[UDP] Discovery server listening on port ${UDP_PORT}`);
    });
} catch (err) {
    console.error(`[UDP] Не удалось запустить Discovery: ${err.message}`);
}

// --- Запуск Сервера ---
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[SERVER] Port ${PORT} already in use!`);
        console.error('[SERVER] Close the other server instance.');
        console.error('[SERVER] Find process: netstat -ano | findstr :' + PORT);
        console.error('[SERVER] Kill process:  taskkill /PID <PID> /F');
        // НЕ вызываем process.exit() — при встраивании в Electron это убьёт всё приложение
    } else {
        console.error('[SERVER] Error:', err);
    }
});

server.listen(PORT, () => {
    console.log(`[SERVER] Listening on port ${PORT}`);
    console.log(`[SERVER] Web interface: http://localhost:${PORT}`);
});
