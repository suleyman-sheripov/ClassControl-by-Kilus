const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Эта строка говорит серверу, что файлы вроде index.html и script.js
// нужно просто отдавать пользователю.
app.use(express.static('public'));

// Хранилище состояний комнат
const rooms = {};

// Хранилище подключенных Агентов (школьных ПК)
const agents = {};

// --- Helper Function ---
function getRoomParticipants(roomId) {
    const room = rooms[roomId];
    if (!room) return [];
    return Array.from(room.users)
        .filter(id => id !== room.teacher) // Exclude teacher from the list if desired, or keep them
        .map(id => ({
            id: id,
            name: room.names[id] || "Unknown"
        }));
}

function broadcastParticipants(roomId) {
    const room = rooms[roomId];
    if (room && room.teacher) {
        const participants = getRoomParticipants(roomId);
        io.to(room.teacher).emit('update-participants', participants);
    }
}

io.on('connection', (socket) => {
    console.log(`[SERVER] Новый пользователь подключился: ${socket.id}`);
    let currentRoomId = null;

    // --- НОВАЯ ЛОГИКА АГЕНТОВ (Школьных ПК) ---
    socket.on('register-agent', (roomId, username) => {
        agents[socket.id] = { id: socket.id, name: username || "Школьный ПК", status: 'online' };
        console.log(`[SERVER] Агент зарегистрирован: ${socket.id}`);
        io.emit('update-agents-list', Object.values(agents));
    });

    socket.on('request-agents-list', () => {
        socket.emit('update-agents-list', Object.values(agents));
    });

    socket.on('request-agent-screen', (agentId) => {
        io.to(agentId).emit('teacher-request-screen', socket.id);
    });

    socket.on('remote-mouse', (payload) => {
        io.to(payload.target).emit('remote-mouse', payload.data);
    });

    socket.on('remote-scroll', (payload) => {
        io.to(payload.target).emit('remote-scroll', payload.data);
    });

    socket.on('remote-keyboard', (payload) => {
        io.to(payload.target).emit('remote-keyboard', payload.data);
    });

    // --- НОВАЯ ЛОГИКА РЕГИСТРАЦИИ УЧИТЕЛЯ ---
    socket.on('register-teacher', (roomId, username) => {
        currentRoomId = roomId;
        socket.join(roomId);
        console.log(`[SERVER] Пользователь ${socket.id} (${username}) регистрируется как УЧИТЕЛЬ в комнате ${roomId}`);

        if (!rooms[roomId]) {
            console.log(`[SERVER] Комната ${roomId} не существует. Создаем новую.`);
            rooms[roomId] = { users: new Set(), names: {} };
        }

        console.log(`[SERVER] Обновляем ID учителя для комнаты ${roomId} на ${socket.id}.`);
        rooms[roomId].teacher = socket.id;
        rooms[roomId].users.add(socket.id);
        rooms[roomId].names[socket.id] = username || "Учитель";

        broadcastParticipants(roomId); // Send initial list
        console.log(`[SERVER] Текущее состояние комнаты ${roomId}: Учитель - ${rooms[roomId].teacher}, Пользователи - ${Array.from(rooms[roomId].users)}`);
    });

    // Когда УЧЕНИК хочет присоединиться к комнате
    socket.on('join-room', (roomId, username) => {
        currentRoomId = roomId;
        socket.join(roomId);
        console.log(`[SERVER] Пользователь ${socket.id} (${username}) присоединился как УЧЕНИК к комнате ${roomId}`);

        if (!rooms[roomId]) {
            console.log(`[SERVER] ОШИБКА: Ученик ${socket.id} попытался войти в несуществующую комнату ${roomId}.`);
            return;
        }
        rooms[roomId].users.add(socket.id);
        rooms[roomId].names[socket.id] = username || "Ученик";

        broadcastParticipants(roomId); // Update teacher's list
        console.log(`[SERVER] Текущее состояние комнаты ${roomId}: Учитель - ${rooms[roomId].teacher}, Пользователи - ${Array.from(rooms[roomId].users)}`);

        // Если ученик присоединяется к уже идущей трансляции
        const room = rooms[roomId];
        if (room.isBroadcasting && room.teacher !== socket.id) {
            console.log(`[SERVER] Ученик ${socket.id} присоединился к активной трансляции. Уведомляем учителя ${room.teacher}.`);
            console.log(`[SERVER] -> ОТПРАВКА 'initiate-single-connection' учителю.`);
            io.to(room.teacher).emit('initiate-single-connection', socket.id, username);
        }
    });

    socket.on('request-room-state', (id, username) => {
        console.log(`[SERVER] Пользователь ${socket.id} запросил состояние комнаты ${id}`);
        const room = rooms[id];
        if (room) {
            socket.emit('room-state', {
                isBroadcasting: room.isBroadcasting,
                canvasState: room.canvasState,
                teacherName: room.names[room.teacher] || "Учитель"
            });
        } else {
            console.log(`[SERVER] Комната ${id} не найдена.`);
            socket.emit('room-state', { error: "Комната не найдена" });
        }
    });

    socket.on('start-broadcast', (id) => {
        console.log(`[SERVER] Учитель ${socket.id} начал трансляцию в комнате ${id}`);
        if (rooms[id]) {
            rooms[id].isBroadcasting = true;
            socket.to(id).emit('broadcast-started');
        }
    });

    socket.on('initiate-connections', (id) => {
        console.log(`[SERVER] Учитель ${socket.id} инициирует подключения в комнате ${id}`);
        const room = rooms[id];
        if (room && room.teacher === socket.id) {
            const students = Array.from(room.users)
                .filter(userId => userId !== socket.id)
                .map(userId => ({ id: userId, name: room.names[userId] }));

            socket.emit('initiate-peer-connections', students);
        }
    });

    socket.on('offer', (payload) => {
        console.log(`[SERVER] Пересылка 'offer' от ${socket.id} к ${payload.target}`);
        io.to(payload.target).emit('offer', { ...payload, source: socket.id });
    });

    socket.on('answer', (payload) => {
        console.log(`[SERVER] Пересылка 'answer' от ${socket.id} к ${payload.target}`);
        io.to(payload.target).emit('answer', { ...payload, source: socket.id });
    });

    socket.on('ice-candidate', (payload) => {
        console.log(`[SERVER] Пересылка 'ice-candidate' от ${socket.id} к ${payload.target}`);
        io.to(payload.target).emit('ice-candidate', { ...payload, source: socket.id });
    });

    socket.on('draw', (data) => {
        if (currentRoomId && rooms[currentRoomId]) {
            rooms[currentRoomId].canvasState = data.image;
            socket.to(currentRoomId).emit('draw', data);
        }
    });

    socket.on('clear-canvas', () => {
        if (currentRoomId && rooms[currentRoomId]) {
            rooms[currentRoomId].canvasState = null;
            socket.to(currentRoomId).emit('clear-canvas');
        }
    });

    socket.on('stop-broadcast', (id) => {
        console.log(`[SERVER] Учитель ${socket.id} остановил трансляцию в комнате ${id}`);
        if (rooms[id]) {
            rooms[id].isBroadcasting = false;
            socket.to(id).emit('broadcast-stopped');
        }
    });

    socket.on('leave-room', (id) => {
        console.log(`[SERVER] Пользователь ${socket.id} покинул комнату ${id}`);
        socket.leave(id);
        if (rooms[id]) {
            if (rooms[id].teacher === socket.id) {
                socket.to(id).emit('user-disconnected', socket.id);
                delete rooms[id];
                console.log(`[SERVER] Комната ${id} закрыта учителем.`);
            } else {
                rooms[id].users.delete(socket.id);
                delete rooms[id].names[socket.id];
                broadcastParticipants(id); // Update teacher's list
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`[SERVER] Пользователь ${socket.id} отключился`);
        
        if (agents[socket.id]) {
            delete agents[socket.id];
            io.emit('update-agents-list', Object.values(agents));
        }

        if (currentRoomId && rooms[currentRoomId]) {
            rooms[currentRoomId].users.delete(socket.id);
            delete rooms[currentRoomId].names[socket.id];

            if (rooms[currentRoomId].teacher === socket.id) {
                socket.to(currentRoomId).emit('user-disconnected', socket.id);
                rooms[currentRoomId].isBroadcasting = false;
                rooms[currentRoomId].teacher = null;
                console.log(`[SERVER] Комната ${currentRoomId} закрыта из-за отключения учителя.`);
            } else {
                broadcastParticipants(currentRoomId); // Update teacher's list
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
