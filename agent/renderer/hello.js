(function () {
  'use strict';
  const api = window.agentAPI;
  const $ = (s) => document.getElementById(s);
  api.info().then((i) => { if (i.student) $('name').value = i.student; });
  api.getRoster().then((list) => {
    (list || []).forEach(n => { const o = document.createElement('option'); o.value = n; $('roster').appendChild(o); });
  });
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!$('name').value.trim()) { $('name').focus(); return; }
    api.setStudent($('name').value, false);
  });
  // Такой ученик уже числится за другим местом
  api.onHelloTaken(({ name, where }) => {
    $('taken-text').textContent = where === 'дома'
      ? `${name} уже на уроке из дома. Вы пришли в класс?`
      : `${name} сейчас за компьютером «${where}». Вы пересели сюда?`;
    $('taken').classList.remove('hidden');
    $('yes').focus();
  });
  $('yes').addEventListener('click', () => api.setStudent($('name').value, true));
  $('no').addEventListener('click', () => {
    $('taken').classList.add('hidden');
    $('name').focus();
    $('name').select();
    $('name').placeholder = 'Добавьте фамилию, чтобы отличаться';
  });
  $('skip').addEventListener('click', () => api.helloSkip());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.helloSkip(); });
})();
