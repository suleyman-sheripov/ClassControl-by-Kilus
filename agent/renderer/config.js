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
    $('#auto-hint').classList.toggle('hidden', m !== 'auto');
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  async function load() {
    const c = await api.configGet();
    if (!c) return;
    $('#pcName').value = c.pcName;
    $('#host-hint').textContent = 'Имя в Windows: ' + c.hostname;
    $('#serverAddress').value = c.serverAddress || '';
    $('#room').value = c.room || '';
    $('#autoStart').checked = c.autoStart;
    $('#notifications').checked = c.notifications;
    $('#st-dot').className = 'dot ' + (c.connected ? 'dot--positive' : 'dot--warning dot--pulse');
    $('#st-text').textContent = c.pendingIdentity&&!c.trustedKey ? 'Подтвердите ключ учителя кнопкой «Проверить подключение»' : c.connected ? 'На связи с учителем · ' + (c.serverAddressNow || '').replace('http://', '') : 'Учитель пока не найден';
    const found = $('#found');
    found.replaceChildren();
    (c.found || []).forEach(f => {
      const label = [f.room || 'кабинет не указан', f.teacher].filter(Boolean).join(', ');
      const b = CC.el('button', { class: 'found__item', type: 'button', title: 'Закрепить за этим кабинетом' }, CC.icon('monitor', 'i-sm'),
        CC.el('span', { style: { fontFamily: 'var(--font)' }, text: label }), CC.el('span', { class: 'faint', style: { marginLeft: 'auto' }, text: f.address.replace('http://', '') }));
      b.addEventListener('click', () => { if (f.room) $('#room').value = f.room; setMode('manual'); $('#serverAddress').value = f.address.replace('http://', ''); });
      found.appendChild(b);
    });
    $('#found-wrap').classList.toggle('hidden', !(c.found || []).length);
    setMode(c.serverMode || 'auto');
  }

  $('#check-address').addEventListener('click', async () => {
    const button=$('#check-address'), result=$('#check-result');button.disabled=true;result.textContent='Проверяю…';
    try {
      const state=await api.configGet();
      const r=await api.configCheck($('#serverAddress').value.trim() || state?.serverAddressNow || state?.lastServer || state?.found?.[0]?.address || '');
      if(!r.ok) {result.textContent='Не удалось подключиться: '+r.error;return;}
      result.textContent=`${r.teacher} · ${r.room || 'Кабинет не указан'}. Ключ: ${r.fingerprint.match(/.{1,4}/g).join(' ')}`;
      if (await CC.confirm('Связать ПК с этим учителем?', 'Сравните ключ с указанным у учителя в «Справке». '+r.fingerprint.match(/.{1,4}/g).join(' ')+'. Подтверждайте только совпадающий ключ своего кабинета.', 'Связать')) {
        if(await api.configTrust(r.fingerprint)) {result.textContent='Ключ учителя сохранён. Подключаюсь…';setMode('manual');$('#serverAddress').value=r.address;}
      }
    } finally {button.disabled=false;}
  });
  $('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api.configSave({
      pcName: $('#pcName').value,
      serverMode: mode,
      serverAddress: $('#serverAddress').value.trim(),
      room: $('#room').value.trim(),
      autoStart: $('#autoStart').checked,
      notifications: $('#notifications').checked
    });
    CC.toast('Сохранено. Агент переподключается.', { kind: 'positive' });
    setTimeout(load, 1500);
  });
  $('#cancel').addEventListener('click', () => { api.configLock(); window.close(); });
  $('#quit').addEventListener('click', async () => {
    if (await CC.confirm('Выключить агент?', 'Агент не будет работать до перезагрузки компьютера или ручного запуска из меню «Пуск».', 'Выключить', 'danger')) api.configQuit();
  });
})();
