'use strict';
/**
 * ClassControl — сервер урока.
 *
 * Работает на компьютере учителя (встроен в приложение учителя) и не требует
 * никаких внешних серверов: ученики в классе находят его по UDP в локальной сети,
 * ученики из дома подключаются по ссылке (бесплатный туннель или проброс порта).
 *
 * Запуск отдельно:  node server/server.js
 * Встраивание:      const srv = await require('./server').start({ dataDir })
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_PORT = 3000;
const UDP_QUERY_PORT = 41234;     // сюда агенты шлют запрос «где сервер?»
const UDP_ANNOUNCE_PORT = 41235;  // сюда сервер сам объявляет себя каждые 3 с
const SHARE_LIMIT_MS = 5 * 60 * 1000;
const MAX_STROKES = 60000;
const MAX_CHAT = 500;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

const ALLOWED_EXTENSIONS = new Set([
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
    '.txt', '.csv', '.rtf', '.md',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp',
    '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.m4a',
    '.zip', '.rar', '.7z',
    '.py', '.js', '.html', '.css', '.java', '.c', '.cpp', '.cs', '.pas', '.json'
]);
const INLINE_IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const TOOLS = new Set(['pen', 'marker', 'eraser']);
const POWER_ACTIONS = new Set(['shutdown', 'restart', 'logoff']);
const CONTROL_ACTIONS = new Set([
    'lock', 'unlock', 'message', 'open-url', 'list-processes', 'kill', 'power', 'input'
]);

// ---------- Утилиты ----------

function cleanText(value, max) {
    return String(value == null ? '' : value)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim()
        .slice(0, max);
}

function normalizeIp(ip) {
    if (!ip) return '';
    return String(ip).replace(/^::ffff:/, '');
}

function isPrivateIp(ip) {
    ip = normalizeIp(ip);
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
    if (/^10\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    if (/^169\.254\./.test(ip)) return true;
    if (/^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
    return false;
}

function isLoopback(ip) {
    ip = normalizeIp(ip);
    return ip === '127.0.0.1' || ip === '::1';
}

/** Адрес из той же сети, что и компьютер учителя (частная сеть или общая подсеть интерфейса). */
function isLanAddress(ip) {
    ip = normalizeIp(ip);
    if (isPrivateIp(ip)) return true;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true; // CGNAT-сети провайдеров и школ
    return ipv4Interfaces().some(i => sameSubnet(i.address, ip, i.netmask));
}

/** Запрос пришёл через туннель (cloudflared / прокси) — значит, это не компьютер класса. */
function isTunneled(headers) {
    return Boolean(headers['cf-connecting-ip'] || headers['x-forwarded-for'] || headers['cf-ray']);
}

function ipv4Interfaces() {
    const out = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
            if (iface.family !== 'IPv4' && iface.family !== 4) continue;
            if (iface.internal) continue;
            out.push({ name, address: iface.address, netmask: iface.netmask });
        }
    }
    return out;
}

function ipToInt(ip) {
    return ip.split('.').reduce((acc, oct) => ((acc << 8) + (parseInt(oct, 10) & 255)) >>> 0, 0);
}

function sameSubnet(a, b, mask) {
    try {
        const m = ipToInt(mask);
        return (ipToInt(a) & m) === (ipToInt(b) & m);
    } catch (e) {
        return false;
    }
}

function broadcastAddress(address, netmask) {
    const a = ipToInt(address), m = ipToInt(netmask);
    const b = (a | (~m >>> 0)) >>> 0;
    return [b >>> 24, (b >>> 16) & 255, (b >>> 8) & 255, b & 255].join('.');
}

/** Интерфейс, через который учитель виден ученику с адресом remoteIp. */
function interfaceFor(remoteIp) {
    const list = ipv4Interfaces();
    const match = list.find(i => sameSubnet(i.address, remoteIp, i.netmask));
    return (match || list[0] || { address: '127.0.0.1' }).address;
}

function makeRateLimiter() {
    const buckets = new Map();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of buckets) if (now - entry.start > 60000) buckets.delete(key);
    }, 60000);
    timer.unref();
    return function allow(key, max, windowMs) {
        const now = Date.now();
        const entry = buckets.get(key);
        if (!entry || now - entry.start > windowMs) {
            buckets.set(key, { start: now, count: 1 });
            return true;
        }
        entry.count++;
        return entry.count <= max;
    };
}

// ---------- Сервер ----------

function start(options = {}) {
    const dataDir = options.dataDir || process.env.CLASSCONTROL_DATA_DIR || path.join(__dirname, 'data');
    const onlineDir = options.onlineDir || path.join(__dirname, '..', 'online');
    const sharedDir = options.sharedDir || path.join(__dirname, '..', 'shared');
    const uploadDir = path.join(dataDir, 'uploads');
    const statePath = path.join(dataDir, 'lesson-state.json');
    const log = options.log || ((...a) => console.log('[SERVER]', ...a));
    const TEACHER_TOKEN = options.token || process.env.TEACHER_TOKEN || crypto.randomBytes(24).toString('hex');
    const preferredPort = options.port || Number(process.env.PORT) || DEFAULT_PORT;

    fs.mkdirSync(uploadDir, { recursive: true });

    const allow = makeRateLimiter();

    // ----- Состояние урока -----
    const state = {
        teacherId: null,
        teacherName: 'Учитель',
        agents: new Map(),        // socketId -> { id, name, host, ip, idle, locked, since }
        demoViewers: new Map(),   // socketId -> host
        online: new Map(),        // socketId -> { id, name, hand, voice, sharing, since }
        broadcast: { active: false, allowExit: false, startedAt: 0 },
        whiteboard: { active: false, transform: { zoom: 1, panX: 0, panY: 0 } },
        strokes: [],
        chat: [],
        attendance: [],           // { name, role, joinedAt, leftAt }
        lessonStartedAt: Date.now(),
        publicUrl: null,
        shareTimers: new Map()
    };

    // Восстановление урока после перезапуска приложения
    try {
        if (fs.existsSync(statePath)) {
            const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
            if (Array.isArray(saved.strokes)) state.strokes = saved.strokes.slice(-MAX_STROKES);
            if (Array.isArray(saved.chat)) state.chat = saved.chat.slice(-MAX_CHAT);
            if (Array.isArray(saved.attendance)) state.attendance = saved.attendance;
            if (saved.lessonStartedAt) state.lessonStartedAt = saved.lessonStartedAt;
            state.attendance.forEach(a => { if (!a.leftAt) a.leftAt = saved.savedAt || Date.now(); });
        }
    } catch (e) {
        log('Не удалось восстановить урок:', e.message);
    }

    let saveTimer = null;
    function persist() {
        if (saveTimer) return;
        saveTimer = setTimeout(() => {
            saveTimer = null;
            const data = {
                savedAt: Date.now(),
                lessonStartedAt: state.lessonStartedAt,
                strokes: state.strokes,
                chat: state.chat,
                attendance: state.attendance
            };
            fs.writeFile(statePath, JSON.stringify(data), (err) => {
                if (err) log('Ошибка сохранения урока:', err.message);
            });
        }, 1500);
    }

    const app = express();
    app.disable('x-powered-by');
    const server = http.createServer(app);

    function originAllowed(origin, host) {
        if (!origin || origin === 'null' || origin.startsWith('file://')) return true;
        try {
            const u = new URL(origin);
            if (host && u.host === host) return true;            // та же страница (в т.ч. через туннель)
            if (u.hostname === 'localhost') return true;
            return isPrivateIp(u.hostname);
        } catch (e) {
            return false;
        }
    }

    const io = new Server(server, {
        maxHttpBufferSize: 2e6,
        cors: { origin: true, methods: ['GET', 'POST'] },
        allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin, req.headers.host))
    });

    // ----- HTTP -----
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('Permissions-Policy', 'camera=(), geolocation=()');
        next();
    });

    app.get(['/', '/index.html'], (req, res, next) => {
        res.setHeader('Content-Security-Policy',
            "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
            "connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
            "script-src 'self'; object-src 'none'; base-uri 'none'");
        next();
    });
    app.use(express.static(onlineDir, { index: 'index.html' }));
    app.use('/ui', express.static(path.join(sharedDir, 'ui')));

    app.get('/files/:name', (req, res) => {
        const name = path.basename(req.params.name);
        const file = path.join(uploadDir, name);
        if (!file.startsWith(uploadDir) || !fs.existsSync(file)) return res.status(404).end();
        const meta = fileMeta.get(name);
        const ext = path.extname(name).toLowerCase();
        const original = meta ? meta.original : name;
        const disposition = INLINE_IMAGE.has(ext) && req.query.view === '1' ? 'inline' : 'attachment';
        res.setHeader('Content-Disposition',
            `${disposition}; filename*=UTF-8''${encodeURIComponent(original)}`);
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
        res.sendFile(file);
    });

    const fileMeta = new Map(); // stored name -> { original }

    const upload = multer({
        storage: multer.diskStorage({
            destination: (req, file, cb) => cb(null, uploadDir),
            filename: (req, file, cb) => {
                const ext = path.extname(file.originalname).toLowerCase();
                cb(null, Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex') + ext);
            }
        }),
        fileFilter: (req, file, cb) => {
            // multer отдаёт имя в latin1 — переводим в UTF-8, чтобы кириллица не ломалась
            try { file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8'); } catch (e) {}
            const ext = path.extname(file.originalname).toLowerCase();
            if (ALLOWED_EXTENSIONS.has(ext)) cb(null, true);
            else cb(new Error(`Файлы «${ext || 'без расширения'}» отправлять нельзя`));
        },
        limits: { fileSize: 50 * 1024 * 1024, files: 1 }
    });

    app.post('/upload', (req, res) => {
        const ip = normalizeIp(req.headers['cf-connecting-ip'] || req.socket.remoteAddress);
        if (!allow(`upload:${ip}`, 8, 60000)) {
            return res.status(429).json({ error: 'Слишком много файлов. Подождите минуту.' });
        }
        upload.single('file')(req, res, (err) => {
            if (err) {
                const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 50 МБ' : err.message;
                return res.status(400).json({ error: msg });
            }
            if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
            const sock = io.sockets.sockets.get(String(req.body.socketId || ''));
            const who = sock && identity(sock);
            if (!who || !who.canChat) {
                fs.unlink(req.file.path, () => {});
                return res.status(403).json({ error: 'Сначала подключитесь к уроку' });
            }
            const ext = path.extname(req.file.filename).toLowerCase();
            fileMeta.set(req.file.filename, { original: req.file.originalname });
            const msg = pushChat(sock, {
                type: 'file',
                filename: cleanText(req.file.originalname, 160),
                url: `/files/${req.file.filename}`,
                size: req.file.size,
                isImage: INLINE_IMAGE.has(ext)
            }, cleanText(req.body.to, 64) || null);
            res.json(msg);
        });
    });

    // ----- Идентичность -----
    function identity(socket) {
        const d = socket.data;
        if (d.role === 'teacher') return { id: socket.id, name: state.teacherName, role: 'teacher', canChat: true };
        if (d.role === 'agent') {
            const a = state.agents.get(socket.id);
            return a && { id: socket.id, name: a.name, role: 'agent', canChat: true };
        }
        if (d.role === 'online') {
            const u = state.online.get(socket.id);
            return u && { id: socket.id, name: u.name, role: 'online', canChat: true };
        }
        return null;
    }

    function teacherSocket() {
        return state.teacherId ? io.sockets.sockets.get(state.teacherId) : null;
    }

    function toTeacher(event, payload) {
        const t = teacherSocket();
        if (t) t.emit(event, payload);
    }

    function agentList() {
        return [...state.agents.values()];
    }

    function onlineList() {
        return [...state.online.values()];
    }

    function pushRoster() {
        toTeacher('roster', { agents: agentList(), online: onlineList() });
    }

    function visibleChat(socketId) {
        return state.chat.filter(m => !m.to || m.to === socketId || m.senderId === socketId ||
            (m.to === 'teacher' && socketId === state.teacherId) || socketId === state.teacherId);
    }

    function pushChat(socket, body, to) {
        const who = identity(socket);
        const msg = {
            id: crypto.randomBytes(6).toString('hex'),
            ts: Date.now(),
            senderId: socket.id,
            sender: who.name,
            role: who.role,
            type: 'text',
            ...body
        };
        if (to) {
            // Личные сообщения: ученик — только учителю, учитель — любому
            if (who.role !== 'teacher') to = 'teacher';
            const target = to === 'teacher' ? null : io.sockets.sockets.get(to);
            if (to !== 'teacher' && !target) return null;
            msg.to = to;
            msg.toName = to === 'teacher' ? state.teacherName : (identity(target) || {}).name || '';
            socket.emit('chat-message', msg);
            if (to === 'teacher') toTeacher('chat-message', msg);
            else target.emit('chat-message', msg);
            if (who.role !== 'teacher' && to !== 'teacher') toTeacher('chat-message', msg);
        } else {
            io.emit('chat-message', msg);
        }
        state.chat.push(msg);
        if (state.chat.length > MAX_CHAT) state.chat.splice(0, state.chat.length - MAX_CHAT);
        persist();
        return msg;
    }

    function systemMessage(text) {
        const msg = { id: crypto.randomBytes(6).toString('hex'), ts: Date.now(), type: 'system', text };
        io.emit('chat-message', msg);
        state.chat.push(msg);
        persist();
    }

    function attendanceJoin(name, role) {
        const entry = { name, role, joinedAt: Date.now(), leftAt: null };
        state.attendance.push(entry);
        persist();
        return entry;
    }

    function uniqueOnlineName(name) {
        const taken = new Set(onlineList().map(u => u.name.toLowerCase()));
        if (!taken.has(name.toLowerCase())) return name;
        for (let i = 2; i < 100; i++) {
            const candidate = `${name} ${i}`;
            if (!taken.has(candidate.toLowerCase())) return candidate;
        }
        return name + ' ' + crypto.randomBytes(2).toString('hex');
    }

    function boardState() {
        return {
            active: state.whiteboard.active,
            transform: state.whiteboard.transform,
            strokes: state.strokes
        };
    }

    function viewerIds() {
        return [...state.online.keys(), ...state.demoViewers.keys()];
    }

    function clearShareTimer(id) {
        const t = state.shareTimers.get(id);
        if (t) clearTimeout(t);
        state.shareTimers.delete(id);
    }

    function links() {
        const list = ipv4Interfaces().map(i => ({ kind: 'lan', url: `http://${i.address}:${actualPort}`, iface: i.name }));
        if (state.publicUrl) list.unshift({ kind: 'public', url: state.publicUrl });
        return list;
    }

    // ----- Socket.IO -----
    io.on('connection', (socket) => {
        const headers = socket.handshake.headers || {};
        socket.data.tunneled = isTunneled(headers);
        socket.data.ip = normalizeIp(socket.handshake.address);
        socket.data.local = !socket.data.tunneled && isLanAddress(socket.data.ip);
        socket.emit('lesson-info', {
            teacherName: state.teacherName,
            teacherOnline: Boolean(state.teacherId),
            broadcasting: state.broadcast.active
        });

        // --- Регистрация ---
        socket.on('register-teacher', (payload = {}) => {
            if (payload.token !== TEACHER_TOKEN || socket.data.tunneled || !isLoopback(socket.data.ip)) {
                socket.emit('auth-error', 'Неверный ключ учителя');
                return;
            }
            const old = teacherSocket();
            if (old && old.id !== socket.id) old.disconnect(true);
            socket.data.role = 'teacher';
            state.teacherId = socket.id;
            if (payload.name) state.teacherName = cleanText(payload.name, 40) || 'Учитель';
            socket.emit('teacher-ready', {
                agents: agentList(),
                online: onlineList(),
                chat: state.chat,
                board: boardState(),
                broadcast: state.broadcast,
                lessonStartedAt: state.lessonStartedAt,
                attendance: state.attendance,
                links: links()
            });
            io.emit('teacher-online', { name: state.teacherName });
            log(`Учитель подключён: ${state.teacherName}`);
        });

        socket.on('register-agent', (payload = {}) => {
            if (!socket.data.local) {
                socket.emit('auth-error', 'Компьютеры класса подключаются только из локальной сети');
                return;
            }
            const host = cleanText(payload.hostname, 64) || 'ПК';
            // Один компьютер — одна карточка: старое подключение того же ПК убираем
            for (const [id, a] of state.agents) {
                if (a.host === host && a.ip === socket.data.ip && id !== socket.id) {
                    state.agents.delete(id);
                    const s = io.sockets.sockets.get(id);
                    if (s) s.disconnect(true);
                }
            }
            socket.data.role = 'agent';
            const agent = {
                id: socket.id,
                name: cleanText(payload.name, 40) || host,
                host,
                ip: socket.data.ip,
                os: cleanText(payload.os, 32),
                idle: 0,
                locked: false,
                since: Date.now()
            };
            state.agents.set(socket.id, agent);
            socket.data.attendance = attendanceJoin(agent.name, 'agent');
            socket.emit('agent-ready', {
                teacherName: state.teacherName,
                broadcast: state.broadcast,
                monitoring: true
            });
            pushRoster();
            log(`ПК подключён: ${agent.name} (${agent.ip})`);
        });

        socket.on('register-demo-viewer', (payload = {}) => {
            if (!socket.data.local) return;
            socket.data.role = 'demo';
            state.demoViewers.set(socket.id, cleanText(payload.hostname, 64));
            socket.emit('board-state', boardState());
            if (state.broadcast.active) toTeacher('peer-request', { ids: [socket.id] });
        });

        socket.on('register-online-user', (payload = {}) => {
            if (!allow(`reg:${socket.id}`, 5, 60000)) return;
            const raw = cleanText(typeof payload === 'string' ? payload : payload.name, 40);
            if (!raw) {
                socket.emit('join-error', 'Введите имя');
                return;
            }
            if (socket.data.role === 'online') return;
            socket.data.role = 'online';
            const user = {
                id: socket.id,
                name: uniqueOnlineName(raw),
                hand: false,
                voice: false,
                sharing: false,
                since: Date.now(),
                remote: socket.data.tunneled
            };
            state.online.set(socket.id, user);
            socket.data.attendance = attendanceJoin(user.name, 'online');
            socket.emit('welcome', {
                id: socket.id,
                name: user.name,
                teacherName: state.teacherName,
                teacherOnline: Boolean(state.teacherId),
                chat: visibleChat(socket.id),
                board: boardState(),
                broadcast: state.broadcast,
                shareLimitMs: SHARE_LIMIT_MS
            });
            pushRoster();
            if (state.broadcast.active) toTeacher('peer-request', { ids: [socket.id] });
            log(`Онлайн-участник: ${user.name}${user.remote ? ' (через интернет)' : ''}`);
        });

        // --- Мониторинг ---
        socket.on('agent-screenshot', (data = {}) => {
            if (socket.data.role !== 'agent') return;
            const agent = state.agents.get(socket.id);
            if (!agent || !data.image) return;
            const size = data.image.byteLength || data.image.length || 0;
            if (size > 1.5e6) return;
            agent.idle = Math.max(0, Number(data.idle) || 0);
            const t = teacherSocket();
            if (t) t.volatile.emit('agent-screenshot', { agentId: socket.id, image: data.image, idle: agent.idle });
        });

        socket.on('agent-status', (data = {}) => {
            if (socket.data.role !== 'agent') return;
            const agent = state.agents.get(socket.id);
            if (!agent) return;
            if (typeof data.locked === 'boolean') agent.locked = data.locked;
            pushRoster();
        });

        socket.on('agent-processes', (data = {}) => {
            if (socket.data.role !== 'agent') return;
            const list = Array.isArray(data.list) ? data.list.slice(0, 300).map(p => ({
                pid: Number(p.pid) || 0,
                name: cleanText(p.name, 80),
                title: cleanText(p.title, 160)
            })) : [];
            toTeacher('agent-processes', { agentId: socket.id, list });
        });

        socket.on('agent-control-result', (data = {}) => {
            if (socket.data.role !== 'agent') return;
            toTeacher('agent-control-result', {
                agentId: socket.id,
                action: cleanText(data.action, 32),
                ok: Boolean(data.ok),
                message: cleanText(data.message, 300)
            });
        });

        socket.on('monitoring-active', (active) => {
            if (socket.data.role !== 'teacher') return;
            for (const id of state.agents.keys()) io.to(id).emit('screenshot-rate', { active: Boolean(active) });
        });

        // --- Управление ПК (только учитель) ---
        socket.on('agent-control', (data = {}) => {
            if (socket.data.role !== 'teacher') return;
            const action = String(data.action || '');
            if (!CONTROL_ACTIONS.has(action)) return;
            let ids = data.agentIds === 'all' ? [...state.agents.keys()] : (Array.isArray(data.agentIds) ? data.agentIds : []);
            ids = ids.filter(id => state.agents.has(id));
            let payload = {};
            const d = data.data || {};
            switch (action) {
                case 'message':
                    payload = { text: cleanText(d.text, 500) };
                    if (!payload.text) return;
                    break;
                case 'lock':
                    payload = { text: cleanText(d.text, 200) };
                    break;
                case 'open-url': {
                    const url = cleanText(d.url, 1000);
                    if (!/^https?:\/\//i.test(url)) return;
                    payload = { url };
                    break;
                }
                case 'kill':
                    payload = { pid: Number(d.pid) || 0, name: cleanText(d.name, 80) };
                    if (!payload.pid && !payload.name) return;
                    break;
                case 'power':
                    if (!POWER_ACTIONS.has(d.mode)) return;
                    payload = { mode: d.mode };
                    break;
                case 'input':
                    payload = d;
                    if (ids.length !== 1) return;
                    break;
                default:
                    payload = {};
            }
            for (const id of ids) {
                if (action === 'input') io.to(id).volatile.emit('control', { action, data: payload });
                else io.to(id).emit('control', { action, data: payload });
            }
        });

        socket.on('remote-start', (data = {}) => {
            if (socket.data.role !== 'teacher' || !state.agents.has(data.agentId)) return;
            io.to(data.agentId).emit('remote-start', { quality: data.quality === 'high' ? 'high' : 'normal' });
        });

        socket.on('remote-stop', (data = {}) => {
            if (socket.data.role !== 'teacher' || !state.agents.has(data.agentId)) return;
            io.to(data.agentId).emit('remote-stop');
        });

        // --- Трансляция ---
        socket.on('start-broadcast', (data = {}) => {
            if (socket.data.role !== 'teacher') return;
            state.broadcast = { active: true, allowExit: Boolean(data.allowExit), startedAt: Date.now() };
            socket.broadcast.emit('broadcast-started', state.broadcast);
            socket.emit('peer-request', { ids: viewerIds() });
            log('Трансляция началась');
        });

        socket.on('stop-broadcast', () => {
            if (socket.data.role !== 'teacher') return;
            state.broadcast = { active: false, allowExit: false, startedAt: 0 };
            socket.broadcast.emit('broadcast-stopped');
            log('Трансляция остановлена');
        });

        // Ретрансляция кадрами, если прямое WebRTC-соединение из дома не установилось
        socket.on('relay-join', () => {
            if (socket.data.role !== 'online') return;
            socket.join('relay');
            toTeacher('relay-count', { count: io.sockets.adapter.rooms.get('relay')?.size || 0 });
        });

        socket.on('relay-leave', () => {
            socket.leave('relay');
            toTeacher('relay-count', { count: io.sockets.adapter.rooms.get('relay')?.size || 0 });
        });

        socket.on('relay-frame', (frame) => {
            if (socket.data.role !== 'teacher' || !frame) return;
            if ((frame.byteLength || frame.length || 0) > 1.5e6) return;
            socket.to('relay').volatile.emit('relay-frame', frame);
        });

        // --- WebRTC-сигналинг ---
        // Ученик может слать сигналы только учителю; учитель — любому участнику.
        socket.on('signal', (data = {}) => {
            if (!allow(`sig:${socket.id}`, 400, 10000)) return;
            if (!socket.data.role) return;
            const kind = ['broadcast', 'remote', 'share', 'voice'].includes(data.kind) ? data.kind : null;
            const type = ['offer', 'answer', 'ice'].includes(data.type) ? data.type : null;
            if (!kind || !type) return;
            let target;
            if (socket.data.role === 'teacher') {
                target = String(data.target || '');
                if (!io.sockets.sockets.has(target)) return;
            } else {
                if (!state.teacherId) return;
                target = state.teacherId;
            }
            io.to(target).emit('signal', { source: socket.id, kind, type, payload: data.payload });
        });

        // --- Доска (только учитель) ---
        socket.on('draw', (s = {}) => {
            if (socket.data.role !== 'teacher') return;
            const nums = [s.x0, s.y0, s.x1, s.y1, s.width];
            if (!nums.every(n => typeof n === 'number' && isFinite(n))) return;
            if (s.width <= 0 || s.width > 0.2) return;
            const stroke = {
                sid: cleanText(s.sid, 24),
                x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1,
                width: s.width,
                color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#111111',
                tool: TOOLS.has(s.tool) ? s.tool : 'pen'
            };
            state.strokes.push(stroke);
            if (state.strokes.length > MAX_STROKES) state.strokes.splice(0, state.strokes.length - MAX_STROKES);
            socket.broadcast.emit('draw', stroke);
            persist();
        });

        socket.on('board-undo', () => {
            if (socket.data.role !== 'teacher' || state.strokes.length === 0) return;
            const sid = state.strokes[state.strokes.length - 1].sid;
            state.strokes = state.strokes.filter(s => s.sid !== sid);
            io.emit('board-strokes', state.strokes);
            persist();
        });

        socket.on('clear-canvas', () => {
            if (socket.data.role !== 'teacher') return;
            state.strokes = [];
            socket.broadcast.emit('clear-canvas');
            persist();
        });

        socket.on('whiteboard-mode', (active) => {
            if (socket.data.role !== 'teacher') return;
            state.whiteboard.active = Boolean(active);
            socket.broadcast.emit('whiteboard-mode', state.whiteboard.active);
        });

        socket.on('whiteboard-transform', (t = {}) => {
            if (socket.data.role !== 'teacher') return;
            const zoom = Number(t.zoom), panX = Number(t.panX), panY = Number(t.panY);
            if (![zoom, panX, panY].every(isFinite)) return;
            state.whiteboard.transform = { zoom: Math.min(8, Math.max(0.25, zoom)), panX, panY };
            socket.broadcast.volatile.emit('whiteboard-transform', state.whiteboard.transform);
        });

        // --- Чат ---
        socket.on('chat-message', (data = {}) => {
            const who = identity(socket);
            if (!who) return;
            if (!allow(`chat:${socket.id}`, 12, 10000)) {
                socket.emit('chat-message', { id: 'rl' + Date.now(), ts: Date.now(), type: 'system', text: 'Слишком часто. Подождите пару секунд.' });
                return;
            }
            const text = cleanText(data.text, 2000);
            if (!text) return;
            pushChat(socket, { type: 'text', text }, data.to ? cleanText(data.to, 64) : null);
        });

        socket.on('request-chat-history', () => {
            if (identity(socket)) socket.emit('chat-history', visibleChat(socket.id));
        });

        // --- Онлайн-участник: рука, голос, показ экрана ---
        socket.on('raise-hand', (up) => {
            const user = state.online.get(socket.id);
            if (!user) return;
            user.hand = Boolean(up);
            pushRoster();
            if (user.hand) toTeacher('hand-raised', { id: user.id, name: user.name });
        });

        socket.on('teacher-voice', (data = {}) => {
            if (socket.data.role !== 'teacher') return;
            const user = state.online.get(data.userId);
            if (!user) return;
            user.voice = Boolean(data.on);
            if (user.voice) user.hand = false;
            io.to(user.id).emit(user.voice ? 'voice-granted' : 'voice-revoked');
            pushRoster();
        });

        socket.on('online-user-share-screen', () => {
            const user = state.online.get(socket.id);
            if (!user || user.sharing) return;
            user.sharing = true;
            user.shareStartedAt = Date.now();
            clearShareTimer(socket.id);
            state.shareTimers.set(socket.id, setTimeout(() => {
                user.sharing = false;
                socket.emit('force-stop-sharing', { reason: 'time' });
                toTeacher('online-user-stopped-sharing', { userId: socket.id });
                pushRoster();
            }, SHARE_LIMIT_MS));
            toTeacher('online-user-sharing', { userId: socket.id, name: user.name });
            pushRoster();
        });

        socket.on('online-user-stop-share', () => {
            const user = state.online.get(socket.id);
            if (!user) return;
            user.sharing = false;
            clearShareTimer(socket.id);
            toTeacher('online-user-stopped-sharing', { userId: socket.id });
            pushRoster();
        });

        socket.on('teacher-accept-share', (data = {}) => {
            if (socket.data.role !== 'teacher') return;
            const user = state.online.get(data.userId);
            if (user && user.sharing) io.to(user.id).emit('share-accepted');
        });

        socket.on('teacher-close-share', (data = {}) => {
            if (socket.data.role !== 'teacher') return;
            const user = state.online.get(data.userId);
            if (!user) return;
            user.sharing = false;
            clearShareTimer(user.id);
            io.to(user.id).emit('force-stop-sharing', { reason: 'teacher' });
            pushRoster();
        });

        socket.on('teacher-kick', (data = {}) => {
            if (socket.data.role !== 'teacher') return;
            const s = io.sockets.sockets.get(data.userId);
            if (s && s.data.role === 'online') {
                s.emit('kicked');
                setTimeout(() => s.disconnect(true), 200);
            }
        });

        // --- Урок ---
        socket.on('lesson-reset', () => {
            if (socket.data.role !== 'teacher') return;
            resetLesson();
        });

        // --- Отключение ---
        socket.on('disconnect', () => {
            if (socket.data.attendance) {
                socket.data.attendance.leftAt = Date.now();
                persist();
            }
            clearShareTimer(socket.id);
            const role = socket.data.role;
            if (role === 'teacher' && state.teacherId === socket.id) {
                state.teacherId = null;
                state.broadcast = { active: false, allowExit: false, startedAt: 0 };
                io.emit('teacher-disconnected');
                io.emit('broadcast-stopped');
                log('Учитель отключился');
            } else if (role === 'agent') {
                state.agents.delete(socket.id);
                pushRoster();
            } else if (role === 'online') {
                const user = state.online.get(socket.id);
                state.online.delete(socket.id);
                if (user && user.sharing) toTeacher('online-user-stopped-sharing', { userId: socket.id });
                toTeacher('peer-gone', { id: socket.id });
                toTeacher('relay-count', { count: io.sockets.adapter.rooms.get('relay')?.size || 0 });
                pushRoster();
            } else if (role === 'demo') {
                state.demoViewers.delete(socket.id);
                toTeacher('peer-gone', { id: socket.id });
            }
        });
    });

    function resetLesson() {
        state.strokes = [];
        state.chat = [];
        state.lessonStartedAt = Date.now();
        // Посещаемость нового урока начинается с тех, кто уже на связи
        state.attendance = [];
        for (const s of io.sockets.sockets.values()) {
            const who = identity(s);
            if (who && who.role !== 'teacher') s.data.attendance = attendanceJoin(who.name, who.role);
        }
        io.emit('clear-canvas');
        io.emit('chat-history', []);
        toTeacher('lesson-started', { lessonStartedAt: state.lessonStartedAt, attendance: state.attendance });
        persist();
    }

    function getLessonSnapshot() {
        return {
            teacherName: state.teacherName,
            lessonStartedAt: state.lessonStartedAt,
            endedAt: Date.now(),
            chat: state.chat.slice(),
            attendance: state.attendance.map(a => ({ ...a })),
            uploadDir
        };
    }

    // ----- Обнаружение в локальной сети (UDP) -----
    let actualPort = preferredPort;
    const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udp.on('message', (msg, rinfo) => {
        if (msg.toString() !== 'CLASSCONTROL_DISCOVER') return;
        const ip = interfaceFor(rinfo.address);
        udp.send(Buffer.from(`CLASSCONTROL_SERVER:${ip}:${actualPort}`), rinfo.port, rinfo.address, () => {});
    });
    udp.on('error', (err) => {
        log(`UDP: ${err.code === 'EADDRINUSE' ? `порт ${UDP_QUERY_PORT} занят, ответы на поиск отключены` : err.message}`);
        try { udp.close(); } catch (e) {}
    });
    try {
        udp.bind(UDP_QUERY_PORT, () => { try { udp.setBroadcast(true); } catch (e) {} });
    } catch (e) {
        log('UDP недоступен:', e.message);
    }

    // Сервер сам объявляет себя: агенты, запущенные раньше учителя, найдут его сразу
    const announcer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    announcer.on('error', () => {});
    announcer.bind(() => {
        try { announcer.setBroadcast(true); } catch (e) {}
    });
    const announceTimer = setInterval(() => {
        for (const iface of ipv4Interfaces()) {
            const msg = Buffer.from(`CLASSCONTROL_SERVER:${iface.address}:${actualPort}`);
            const targets = [broadcastAddress(iface.address, iface.netmask), '255.255.255.255'];
            for (const t of targets) announcer.send(msg, UDP_ANNOUNCE_PORT, t, () => {});
        }
    }, 3000);
    announceTimer.unref();

    // ----- Очистка старых файлов -----
    const cleanupTimer = setInterval(() => {
        try {
            const now = Date.now();
            for (const file of fs.readdirSync(uploadDir)) {
                const p = path.join(uploadDir, file);
                if (now - fs.statSync(p).mtimeMs > UPLOAD_TTL_MS) fs.unlinkSync(p);
            }
        } catch (e) {}
    }, 60 * 60 * 1000);
    cleanupTimer.unref();

    // ----- Запуск -----
    return new Promise((resolve, reject) => {
        let attempt = 0;
        const tryListen = (port) => {
            server.once('error', (err) => {
                if (err.code === 'EADDRINUSE' && attempt < 10) {
                    attempt++;
                    log(`Порт ${port} занят, пробую ${port + 1}`);
                    tryListen(port + 1);
                } else {
                    reject(err);
                }
            });
            server.listen(port, () => {
                actualPort = port;
                log(`Сервер урока запущен: http://localhost:${port}`);
                resolve({
                    port,
                    token: TEACHER_TOKEN,
                    io,
                    links,
                    setPublicUrl(url) {
                        state.publicUrl = url || null;
                        toTeacher('links', links());
                    },
                    getLessonSnapshot,
                    resetLesson,
                    close() {
                        clearInterval(announceTimer);
                        clearInterval(cleanupTimer);
                        try { udp.close(); } catch (e) {}
                        try { announcer.close(); } catch (e) {}
                        io.close();
                        return new Promise(r => server.close(() => r()));
                    }
                });
            });
        };
        tryListen(preferredPort);
    });
}

module.exports = { start, _internals: { isPrivateIp, isTunneled, sameSubnet, broadcastAddress, cleanText } };

if (require.main === module) {
    start().then((srv) => {
        console.log(`[SERVER] Ключ учителя: ${srv.token}`);
        console.log('[SERVER] Страница для учеников из дома:', srv.links().map(l => l.url).join('  '));
    }).catch((err) => {
        console.error('[SERVER] Не удалось запустить:', err.message);
        process.exit(1);
    });
}
