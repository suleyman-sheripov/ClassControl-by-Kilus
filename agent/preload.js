const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  getScreenStream: () => ipcRenderer.invoke('get-screen-stream-source').then(async (sourceId) => {
    if (!sourceId) return null;
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 15
        }
      }
    });
  }),
  onServerAddress: (callback) => ipcRenderer.on('server-address', (e, addr) => callback(addr)),
  openDemo: () => ipcRenderer.send('open-demo'),
  closeDemo: () => ipcRenderer.send('close-demo'),
  openChat: () => ipcRenderer.send('open-chat'),
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  platform: process.platform,
  hostname: require('os').hostname()
});
