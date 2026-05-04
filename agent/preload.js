const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  onServerAddress: (callback) => ipcRenderer.on('server-address', (e, addr) => callback(addr)),
  openDemo: () => ipcRenderer.send('open-demo'),
  closeDemo: () => ipcRenderer.send('close-demo'),
  openChat: () => ipcRenderer.send('open-chat'),
  platform: process.platform,
  hostname: require('os').hostname()
});
