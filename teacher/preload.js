const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Вызов получения источников экрана
  getSources: () => ipcRenderer.invoke('get-sources'),
  
  // Слушатель событий навигации (если понадобится)
  onNavigate: (callback) => ipcRenderer.on('navigate', (event, path) => callback(path)),
  
  // Информация о платформе
  platform: process.platform
});
