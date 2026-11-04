(async function () {
  'use strict';
  const api = window.agentAPI;
  let info = await api.info();
  let base = info.serverAddress;

  const chat = new CC.Chat(document.getElementById('chat'), {
    meId: info.socketId,
    placeholder: 'Сообщение классу…',
    emptyText: 'Здесь сообщения учителя и класса. Можно отправить файл с заданием.',
    fileUrl: (u) => (base || '') + u,
    onSend: (text, to) => api.chatSend({ text, to }),
    onFile: async (file, to) => {
      info = await api.info();
      if (!info.connected) return CC.toast('Нет связи с учителем', { kind: 'warning' });
      CC.uploadFile(info.serverAddress, info.socketId, file, to);
    }
  });
  // Ученик может написать учителю лично
  const toTeacher = CC.el('button', { class: 'icon-btn', type: 'button', title: 'Написать учителю лично', 'aria-label': 'Написать учителю лично' }, CC.icon('lock'));
  toTeacher.addEventListener('click', () => chat.setRecipient(chat.to ? null : { id: 'teacher', name: info.teacherName || 'учитель' }));
  document.querySelector('.chat-head').appendChild(toTeacher);

  function render(s) {
    document.getElementById('dot').className = 'dot ' + (s.connected ? 'dot--positive' : 'dot--warning dot--pulse');
    document.getElementById('status').textContent = s.connected ? `На связи · ${s.teacherName || 'учитель'}` : 'Ищу учителя в сети…';
    chat.input.disabled = !s.connected;
  }
  render(info);
  api.onConnection(async (s) => {
    info = await api.info();
    base = info.serverAddress;
    chat.opts.meId = info.socketId;
    render(s);
    if (s.connected) api.chatRequestHistory();
  });
  api.onChatEvent((ev) => {
    if (ev.type === 'history') chat.setHistory(ev.list);
    if (ev.type === 'message') chat.add(ev.msg);
  });
  if (info.connected) api.chatRequestHistory();
  else chat.setHistory([]);
})();
