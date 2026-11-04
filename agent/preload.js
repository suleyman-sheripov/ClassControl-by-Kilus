'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (e, data) => cb(data));

contextBridge.exposeInMainWorld('agentAPI', {
  info: () => ipcRenderer.invoke('agent-info'),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  onServerAddress: on('server-address'),
  onConnection: on('connection-state'),
  connectionState: (s) => ipcRenderer.send('connection-state', s),

  // Фоновое окно
  control: (cmd) => ipcRenderer.send('control', cmd),
  remoteSession: (on) => ipcRenderer.send('remote-session', on),
  broadcast: (st) => ipcRenderer.send('broadcast', st),
  onAgentStatus: on('agent-status'),
  onProcesses: on('processes'),
  onControlResult: on('control-result'),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  setFocus: (f) => ipcRenderer.send('set-focus', f),
  assignment: (item) => ipcRenderer.send('assignment', item),
  task: (t) => ipcRenderer.send('task', t),
  onSocketEmit: on('socket-emit'),

  // Окно задания (опрос, сдача работы)
  onTask: on('task'),
  taskAnswer: (pollId, option) => ipcRenderer.send('task-answer', { pollId, option }),
  taskSubmit: (collectId) => ipcRenderer.invoke('task-submit', collectId),
  taskClose: () => ipcRenderer.send('task-close'),
  openFile: (p) => ipcRenderer.send('open-file', p),

  // Чат (окно беседы ⇄ фоновое окно)
  chatSend: (msg) => ipcRenderer.send('chat-send', msg),
  onChatSend: on('chat-send'),
  chatEvent: (ev) => ipcRenderer.send('chat-event', ev),
  onChatEvent: on('chat-event'),
  chatRequestHistory: () => ipcRenderer.send('chat-request-history'),
  onChatRequestHistory: on('chat-request-history'),
  openChat: () => ipcRenderer.send('open-chat'),

  // Демонстрация
  closeDemo: () => ipcRenderer.send('close-demo'),
  onBroadcastState: on('broadcast-state'),

  // Служебные окна
  onLockText: on('lock-text'),
  onMessage: on('message'),
  closeMessage: () => ipcRenderer.send('message-close'),
  onBannerText: on('banner-text'),

  // Настройки
  configState: () => ipcRenderer.invoke('config-state'),
  configUnlock: (pw) => ipcRenderer.invoke('config-unlock', pw),
  configGet: () => ipcRenderer.invoke('config-get'),
  configSave: (patch) => ipcRenderer.invoke('config-save', patch),
  configQuit: () => ipcRenderer.invoke('config-quit'),
  configLock: () => ipcRenderer.send('config-lock')
});
