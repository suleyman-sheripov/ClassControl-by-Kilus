let socket = null;
let screenshotInterval = null;
let agentName = window.electronAPI.hostname || 'Ученик'; 

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

    // Удалённое управление
    socket.on('request-screen-share', () => {
      // Здесь WebRTC: захватить экран, отправить поток учителю
      // startScreenShare();
      console.log('[AGENT] Request screen share received');
    });

    socket.on('control-command', ({ action, data }) => {
      // Отправить команду в nut-js через IPC
      // window.electronAPI.executeControl(action, data);
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
