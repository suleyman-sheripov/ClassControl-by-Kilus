let socket = null;
let screenshotInterval = null;
let agentName = window.electronAPI.hostname || 'Ученик';
let remotePC = null;
const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }; 

// Ждём адрес сервера от main process
window.electronAPI.onServerAddress((address) => {
  connectToServer(address);
});

function connectToServer(address) {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  stopScreenshots();

  socket = io(address);

  socket.on('connect', () => {
      console.log('[AGENT] Подключён:', socket.id);
      socket.emit('register-agent', agentName);
      stopScreenshots();
      startScreenshots();
    });

    socket.on('disconnect', () => {
      console.log('[AGENT] Отключён от сервера');
      stopScreenshots();
    });

    // Удалённое управление — учитель запросил экран
    socket.on('request-screen-share', async () => {
      console.log('[AGENT] Запрос демонстрации экрана от учителя');
      try {
        const screenStream = await window.electronAPI.getScreenStream();
        if (!screenStream) {
          console.error('[AGENT] Не удалось захватить экран');
          return;
        }

        if (remotePC) remotePC.close();
        remotePC = new RTCPeerConnection(iceConfig);

        screenStream.getTracks().forEach(track => remotePC.addTrack(track, screenStream));

        remotePC.onicecandidate = (e) => {
          if (e.candidate) {
            socket.emit('ice-candidate', { target: 'teacher', candidate: e.candidate, connectionType: 'remote' });
          }
        };

        remotePC.onconnectionstatechange = () => {
          console.log('[AGENT] Remote PC state:', remotePC.connectionState);
          if (remotePC.connectionState === 'disconnected' || remotePC.connectionState === 'failed') {
            screenStream.getTracks().forEach(t => t.stop());
            remotePC.close();
            remotePC = null;
          }
        };

        const offer = await remotePC.createOffer();
        await remotePC.setLocalDescription(offer);
        socket.emit('offer', { target: 'teacher', sdp: remotePC.localDescription, connectionType: 'remote' });
      } catch (err) {
        console.error('[AGENT] Ошибка захвата экрана:', err);
      }
    });

    // WebRTC сигналинг
    socket.on('answer', async ({ source, sdp }) => {
      if (remotePC) {
        try {
          await remotePC.setRemoteDescription(new RTCSessionDescription(sdp));
        } catch (err) {
          console.error('[AGENT] Error setting answer:', err);
        }
      }
    });

    socket.on('ice-candidate', async ({ source, candidate }) => {
      if (remotePC) {
        try {
          await remotePC.addIceCandidate(candidate);
        } catch (err) {
          console.error('[AGENT] ICE error:', err);
        }
      }
    });

    socket.on('control-command', ({ action, data }) => {
      console.log('[AGENT] Control command:', action, data);
    });

    // Демонстрация учителя
    socket.on('broadcast-started', () => {
      window.electronAPI.openDemo();
    });
    socket.on('broadcast-stopped', () => {
      window.electronAPI.closeDemo();
    });

    // Уведомление об отключении учителя
    socket.on('teacher-disconnected', () => {
      console.log('[AGENT] Учитель отключился');
      window.electronAPI.closeDemo();
      window.electronAPI.showNotification('ClassControl', 'Учитель отключился от сервера');
    });
}

// Скриншоты каждую секунду
function startScreenshots() {
  if (screenshotInterval) return;
  screenshotInterval = setInterval(async () => {
    if (!socket || !socket.connected) return;
    try {
        const imageBase64 = await window.electronAPI.takeScreenshot();
        if (imageBase64) {
          socket.emit('agent-screenshot', { agentId: socket.id, imageBase64 });
        }
    } catch(err) {
        console.error('Screenshot error', err);
    }
  }, 1000);
}

function stopScreenshots() {
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }
}
