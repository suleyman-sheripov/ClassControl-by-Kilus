(async function () {
  'use strict';
  const api = window.agentAPI;
  const $ = (s) => document.querySelector(s);
  let mode = 'auto';

  const st = await api.configState();
  if (!st.hasPassword) {
    $('#pw-label').textContent = 'Придумайте пароль администратора';
    $('#pw-hint').textContent = 'Без него ученики не смогут менять настройки и выключать агент.';
    $('#pw-btn').textContent = 'Сохранить пароль';
    $('#pw').autocomplete = 'new-password';
  }
  $('#pw').focus();

  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api.configUnlock($('#pw').value);
    if (!r.ok) { $('#pw-error').textContent = r.error; $('#pw').select(); return; }
    $('#login').classList.add('hidden');
    $('#form').classList.remove('hidden');
    load();
  });

  function setMode(m) {
    mode = m;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('is-active', b.dataset.mode === m));
    $('#manual').classList.toggle('hidden', m !== 'manual');
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  async function load() {
    const c = await api.configGet();
    if (!c) return;
    $('#pcName').value = c.pcName;
    $('#host-hint').textContent = 'Имя в Windows: ' + c.hostname;
    $('#serverAddress').value = c.serverAddress || '';
    $('#autoStart').checked = c.autoStart;
    $('#notifications').checked = c.notifications;
    $('#st-dot').className = 'dot ' + (c.connected ? 'dot--positive' : 'dot--warning dot--pulse');
    $('#st-text').textContent = c.connected ? 'На связи с учителем · ' + (c.serverAddressNow || '').replace('http://', '') : 'Учитель пока не найден';
    const found = $('#found');
    found.replaceChildren();
    (c.found || []).forEach(a => {
      const b = CC.el('button', { class: 'found__item', type: 'button' }, CC.icon('monitor', 'i-sm'), a.replace('http://', ''));
      b.addEventListener('click', () => { $('#serverAddress').value = a.replace('http://', ''); });
      found.appendChild(b);
    });
    setMode(c.serverMode || 'auto');
  }

  $('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api.configSave({
      pcName: $('#pcName').value,
      serverMode: mode,
      serverAddress: $('#serverAddress').value.trim(),
      autoStart: $('#autoStart').checked,
      notifications: $('#notifications').checked
    });
    CC.toast('Сохранено. Агент переподключается.', { kind: 'positive' });
    setTimeout(load, 1500);
  });
  $('#cancel').addEventListener('click', () => { api.configLock(); window.close(); });
  $('#quit').addEventListener('click', async () => {
    if (await CC.confirm('Выключить агент?', 'Учитель перестанет видеть этот компьютер до следующего запуска.', 'Выключить', 'danger')) api.configQuit();
  });
})();
