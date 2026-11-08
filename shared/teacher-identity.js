'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PROTECTED = new Set([
  'interactive-update',
  'agent-ready',
  'control',
  'remote-start',
  'remote-stop',
  'broadcast-started',
  'broadcast-stopped',
  'whiteboard-mode',
  'draw',
  'whiteboard-transform',
  'board-state',
  'board-undo',
  'clear-canvas',
  'board-strokes',
  'assignment',
  'bind-room',
  'released',
  'class-prefs',
  'screenshot-rate',
  'teacher-online',
  'teacher-disconnected',
  'seat-changed',
  'lesson-ended',
  'lesson-id',
  'poll',
  'poll-closed',
  'collect-request',
  'collect-closed',
  'focus',
  'lesson-rules',
  'signal',
  'relay-child',
  'relay-child-gone'
]);
function fingerprint(key) {
  return crypto
    .createHash('sha256')
    .update(crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }))
    .digest('hex');
}
function loadIdentity(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file))
    fs.writeFileSync(
      file,
      crypto
        .generateKeyPairSync('ed25519')
        .privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { mode: 0o600, flag: 'wx' }
    );
  const privateKey = crypto.createPrivateKey(fs.readFileSync(file));
  const publicKey = crypto
    .createPublicKey(privateKey)
    .export({ type: 'spki', format: 'pem' });
  return {
    publicKey,
    fingerprint: fingerprint(publicKey),
    sign: (event) =>
      crypto.sign(null, Buffer.from(event), privateKey).toString('base64')
  };
}
function payload(nonce, seq, event, args) {
  return JSON.stringify({ nonce, seq, event, args });
}
function verify(publicKey, event, args, proof, nonce) {
  try {
    return (
      proof &&
      proof.ccProof === 1 &&
      proof.nonce === nonce &&
      Number.isSafeInteger(proof.seq) &&
      crypto.verify(
        null,
        Buffer.from(payload(nonce, proof.seq, event, args)),
        publicKey,
        Buffer.from(proof.signature, 'base64')
      )
    );
  } catch {
    return false;
  }
}
function signEvents(io, identity) {
  io.on('connection', (socket) => {
    const emit = socket.emit.bind(socket);
    let seq = 0;
    socket.emit = (event, ...args) => {
      if (PROTECTED.has(event)) {
        const nonce = String(socket.handshake.auth?.nonce || '');
        const n = ++seq;
        args.push({
          ccProof: 1,
          nonce,
          seq: n,
          signature: identity.sign(payload(nonce, n, event, args))
        });
      }
      return emit(event, ...args);
    };
  });
  const adapter = io.of('/').adapter,
    broadcast = adapter.broadcast.bind(adapter);
  adapter.broadcast = (packet, opts) => {
    if (!packet.data || !PROTECTED.has(packet.data[0]))
      return broadcast(packet, opts);
    // Per-connection nonces prevent replay after reconnect. Preserve room/except/volatile semantics.
    for (const socket of io.of('/').sockets.values()) {
      if ([...opts.except].some((room) => socket.rooms.has(room))) continue;
      if (
        opts.rooms.size &&
        ![...opts.rooms].some((room) => socket.rooms.has(room))
      )
        continue;
      socket.flags = { ...socket.flags, ...opts.flags };
      socket.emit(...packet.data);
    }
  };
}
module.exports = { loadIdentity, fingerprint, verify, signEvents, PROTECTED };
