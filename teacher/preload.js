'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('teacherAPI', {
  boot: () => ipcRenderer.invoke('boot'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  pickFolder: (current) => ipcRenderer.invoke('pick-folder', current),
  getSources: () => ipcRenderer.invoke('get-sources'),
  setShareSource: (id) => ipcRenderer.invoke('set-share-source', id),
  ownWindowSource: () => ipcRenderer.invoke('own-window-source'),
  keepAwake: (on) => ipcRenderer.invoke('keep-awake', on),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  recStart: (opts) => ipcRenderer.invoke('rec-start', opts),
  recChunk: (buf) => ipcRenderer.send('rec-chunk', buf),
  recStop: () => ipcRenderer.invoke('rec-stop'),
  lessonStart: (data) => ipcRenderer.invoke('lesson-start', data),
  lessonEnd: (data) => ipcRenderer.invoke('lesson-end', data),
  previousLesson: (data) => ipcRenderer.invoke('previous-lesson', data),
  newLessonCode: () => ipcRenderer.invoke('new-lesson-code'),
  saveBoard: (dataUrl) => ipcRenderer.invoke('save-board', dataUrl),
  tunnel: (on) => ipcRenderer.invoke('tunnel', on),
  onTunnel: (cb) => ipcRenderer.on('tunnel-status', (e, s) => cb(s)),
  platform: process.platform
});
