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
      CC.uploadFile(info.serverAddress, info.socketId, file, to, { token: info.uploadToken });
    }
  });
  // Ученик может написать учителю лично
  const toTeacher = CC.el('button', { class: 'icon-btn', type: 'button', title: 'Написать учителю лично', 'aria-label': 'Написать учителю лично' }, CC.icon('lock'));
  toTeacher.addEventListener('click', () => chat.setRecipient(chat.to ? null : { id: 'teacher', name: info.teacherName || 'учитель' }));
  // «Это я»: ученик может представиться, и учитель увидит его имя у этого ПК
  const meBtn = CC.el('button', { class: 'icon-btn', type: 'button', title: 'Представиться', 'aria-label': 'Представиться' }, CC.icon('user'));
  meBtn.addEventListener('click', () => api.openHello());
  // Ученик в классе может поднять руку так же, как ученик из дома
  let hand = false;
  const handBtn = CC.el('button', { class: 'icon-btn', type: 'button', title: 'Поднять руку', 'aria-label': 'Поднять руку', 'aria-pressed': 'false' }, CC.icon('raise'));
  const renderHand = () => { handBtn.classList.toggle('is-on', hand); handBtn.title = hand ? 'Опустить руку' : 'Поднять руку'; handBtn.setAttribute('aria-pressed', String(hand)); };
  handBtn.addEventListener('click', () => { hand = !hand; api.raiseHand(hand); renderHand(); });
  api.onHand((v) => { hand = v; renderHand(); });
  document.querySelector('.chat-head').append(handBtn, meBtn, toTeacher);

  function render(s) {
    document.getElementById('dot').className = 'dot ' + (s.connected ? 'dot--positive' : 'dot--warning dot--pulse');
    document.getElementById('status').textContent = s.connected ? `${s.teacherName || 'Учитель'} на связи` + (s.student ? `, вы: ${s.student}` : '') : 'Ищу учителя в сети…';
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
