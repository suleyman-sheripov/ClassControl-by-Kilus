/* ClassControl — окно учителя. */
(async function () {
  'use strict';
  const { $, $$, el, icon, toast } = CC;

  // В обычном браузере (для проверки вёрстки) окна Electron нет — подставляем заглушку
  const api = window.teacherAPI || browserStub();
  function browserStub() {
    const q = new URLSearchParams(location.search);
    const store = {};
    return {
      boot: async () => ({ port: Number(q.get('port')) || 3000, token: q.get('token') || '', settings: { onboarded: !q.has('firstrun'), teacherName: 'Учитель', roomName: q.has('firstrun') ? '' : 'Кабинет 301', quality: '1280x720', fps: 15, recordDir: '~/Видео/ClassControl', reportDir: '~/Документы/ClassControl' }, tunnel: { state: 'off' } }),
      saveSettings: async (p) => Object.assign(store, p),
      getSources: async () => [], setShareSource: async () => {}, ownWindowSource: async () => null,
      keepAwake: async () => {}, openPath: async () => {}, openFolder: async () => {}, openExternal: async (u) => window.open(u),
      recStart: async () => null, recChunk: () => {}, recStop: async () => null,
      lessonStart: async () => null, lessonEnd: async () => { if (window.__socket) window.__socket.emit('lesson-reset'); return { ok: true }; }, previousLesson: async () => ({ ok: true }), saveBoard: async () => null, newLessonCode: async () => null,
      tunnel: async () => ({ state: 'off' }), onTunnel: () => {}, pickFolder: async () => null
    };
  }

  const boot = await api.boot();
  let settings = boot.settings;
  const BASE = `http://localhost:${boot.port || 3000}`;

  // ---------- Состояние ----------
  const S = {
    agents: new Map(),
    online: new Map(),
    selected: new Set(),
    shots: new Map(),            // agentId -> objectURL
    filter: '',
    peopleTab: 'class',
    tab: 'monitoring',
    links: [],
    tunnel: boot.tunnel || { state: 'off' },
    lessonStartedAt: Date.now(),
    connected: false
  };

  // ---------- Подключение к серверу урока ----------
  setServerStatus('wait', boot.serverError ? 'Сервер не запустился: ' + boot.serverError : 'Подключение к серверу урока…');
  try {
    await loadScript(`${BASE}/socket.io/socket.io.js`);
  } catch (e) {
    setServerStatus('error', 'Сервер урока недоступен');
    return;
  }
  const socket = io(BASE, { transports: ['websocket'] });
  if (!window.teacherAPI) window.__socket = socket;   // браузерная заглушка: завершает урок сама

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  socket.on('connect', () => {
    socket.emit('register-teacher', { token: boot.token, name: S.teacherName || 'Учитель' });
  });
  socket.on('disconnect', () => { S.connected = false; setServerStatus('wait', 'Переподключение к серверу…'); });
  socket.on('auth-error', (m) => setServerStatus('error', m));

  socket.on('teacher-ready', (st) => {
    S.connected = true;
    setServerStatus('ok', `Сервер урока работает, порт ${boot.port}`);
    S.lessonStartedAt = st.lessonStartedAt;
    S.links = st.links || [];
    S.uploadToken = st.uploadToken;
    S.lessonCode = st.lessonCode;
    applyRoster({ agents: st.agents, online: st.online, offline: st.offline });
    S.ready = true;
    applyActivity(st.activity);
    chat.setHistory(st.chat);
    board.setStrokes(st.board.strokes || []);
    renderLinks();
    syncMonitoring();
    if (Broadcast.active) socket.emit('start-broadcast', { allowExit: $('#opt-exit').checked });
    socket.emit('whiteboard-mode', B.shared);
  });

  socket.on('roster', applyRoster);
  socket.on('links', (l) => { S.links = l; renderLinks(); });
  socket.on('lesson-started', (d) => { S.lessonStartedAt = d.lessonStartedAt; if (d.lessonCode) S.lessonCode = d.lessonCode; });

  // ---------- Верхняя панель: урок ----------
  $('#room-name').textContent = settings.roomName || 'Кабинет не указан';
  setInterval(() => { $('#lesson-time').textContent = CC.duration(Date.now() - S.lessonStartedAt); }, 1000);
  $('#lesson-chip').addEventListener('click', () => openLessonMenu($('#lesson-chip')));
  $('#menu-btn').addEventListener('click', () => openLessonMenu($('#menu-btn'), true));

  function openLessonMenu(anchor, right) {
    CC.menu(anchor, [
      { icon: 'save', label: 'Завершить урок', run: endLesson },
      '-',
      { icon: 'lock', label: 'Закрепить ПК за этим кабинетом', run: bindRoom },
      themeItem(),
      { icon: 'settings', label: 'Настройки', run: openSettings }
    ], { alignRight: right });
  }

  // Урок одноразовый: после него на компьютере ничего не остаётся, если учитель сам не сохранил
  async function endLesson() {
    if (Recorder.active) { toast('Сначала остановите запись урока', { kind: 'warning', icon: 'record' }); return; }
    const has = board.strokes.length || chat.list.querySelector('.msg:not(.msg--system)') || S.activity.polls.length || S.activity.collections.length;
    const choice = await CC.dialog({
      title: 'Завершить урок?',
      sub: has ? 'Чат, доска, опросы, сданные работы и файлы сотрутся с этого компьютера. Сохраните их, если нужно, — в любую папку или на флешку.' : 'Ученики из дома выйдут, у следующего урока будет новая ссылка.',
      actions: has
        ? [{ label: 'Отмена', value: null }, { label: 'Не сохранять', value: 'drop' }, { label: 'Сохранить и завершить', kind: 'primary', primary: true, value: 'save' }]
        : [{ label: 'Отмена', value: null }, { label: 'Завершить', kind: 'primary', primary: true, value: 'drop' }]
    });
    if (!choice) return;
    if (Broadcast.active) Broadcast.stop();
    if (B.shared) setBoardShared(false);
    const r = await api.lessonEnd({ save: choice === 'save', boardPng: choice === 'save' && board.strokes.length ? board.toPNG() : null });
    if (!r || !r.ok) return;   // отказались выбирать папку — урок продолжается
    board.clear();
    if (r.dir) toast('Материалы урока сохранены', { kind: 'positive', action: { label: 'Открыть', run: () => api.openFolder(r.dir) } });
    startLesson();
  }

  /** Новый урок: учитель представляется только на этот урок — учителя в кабинете меняются. */
  async function startLesson() {
    const name = el('input', { class: 'input input--lg', placeholder: 'Например: Анна Петровна', maxlength: 40 });
    const ok = await CC.dialog({
      hero: { point: 'down', motion: 'nudge' },
      title: 'Новый урок', sub: `${settings.roomName || 'Кабинет'}. Ученики увидят ваше имя в чате и на странице входа.`,
      body: el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Как вас зовут' }), name),
      actions: [{ label: 'Начать урок', kind: 'primary', primary: true, value: () => true }]
    });
    S.teacherName = (ok && name.value.trim()) || 'Учитель';
    $('#teacher-name').textContent = S.teacherName === 'Учитель' ? '' : S.teacherName;
    const code = await api.lessonStart({ teacherName: S.teacherName });
    if (code) S.lessonCode = code;
    socket.emit('register-teacher', { token: boot.token, name: S.teacherName });
  }

  /** Программу закрыли посреди урока: продолжить его, сохранить или начать с чистого листа. */
  async function askPrevious(p) {
    const when = new Date(p.startedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const what = [p.messages && `${p.messages} ${CC.plural(p.messages, 'сообщение', 'сообщения', 'сообщений')}`, p.strokes && p.strokes.length && 'доска', p.polls && `${p.polls} ${CC.plural(p.polls, 'опрос', 'опроса', 'опросов')}`, p.works && `${p.works} ${CC.plural(p.works, 'работа', 'работы', 'работ')}`].filter(Boolean).join(', ');
    const choice = await CC.dialog({
      hero: { point: 'right', motion: 'float' },
      title: 'Прошлый урок не был завершён',
      sub: `${p.teacherName && p.teacherName !== 'Учитель' ? p.teacherName + ', ' : ''}начат ${when}. Осталось: ${what || 'немного данных'}.`,
      actions: [{ label: 'Не сохранять', value: 'drop' }, { label: 'Сохранить…', value: 'save' }, { label: 'Продолжить урок', kind: 'primary', primary: true, value: 'resume' }]
    });
    if (choice === 'resume') {
      await api.previousLesson({ action: 'resume' });
      S.teacherName = p.teacherName || 'Учитель';
      $('#teacher-name').textContent = S.teacherName === 'Учитель' ? '' : S.teacherName;
      socket.emit('register-teacher', { token: boot.token, name: S.teacherName });
      return;
    }
    const r = await api.previousLesson({ action: choice === 'save' ? 'save' : 'drop', boardPng: choice === 'save' && p.strokes && p.strokes.length ? CC.Board.toPNG(p.strokes) : null });
    if (r && r.canceled) return askPrevious(p);
    if (r && r.dir) toast('Материалы прошлого урока сохранены', { kind: 'positive', action: { label: 'Открыть', run: () => api.openFolder(r.dir) } });
    startLesson();
  }

  // Настройки кабинета (не учителя): название кабинета, папки по умолчанию для сохранения
  async function openSettings() {
    const room = el('input', { class: 'input', value: settings.roomName || '' });
    const recDir = el('input', { class: 'input', value: settings.recordDir || '', readonly: true });
    const repDir = el('input', { class: 'input', value: settings.reportDir || '', readonly: true });
    const folder = (input) => el('div', { class: 'folder-field' }, input,
      el('button', { class: 'btn', type: 'button', text: 'Выбрать', onclick: async () => { const p = await api.pickFolder(input.value); if (p) input.value = p; } }));
    const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
      el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Кабинет' }), room),
      el('p', { class: 'onboard__why', text: 'Компьютеры класса подключаются только к учителю своего кабинета.' }),
      el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Куда предлагать сохранять записи' }), folder(recDir)),
      el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Куда предлагать сохранять материалы урока' }), folder(repDir)));
    const saved = await CC.dialog({
      title: 'Настройки кабинета', body, wide: true,
      actions: [{ label: 'Отмена', value: null }, { label: 'Сохранить', kind: 'primary', primary: true, value: () => true }]
    });
    if (!saved) return;
    settings = await api.saveSettings({ roomName: room.value.trim() || settings.roomName, recordDir: recDir.value, reportDir: repDir.value }) || settings;
    $('#room-name').textContent = settings.roomName;
    toast('Настройки сохранены', { kind: 'positive' });
  }

  // ---------- Переключение режимов ----------
  function setTab(tab) {
    if (tab === S.tab) return;
    // Смена режима — мягким переходом (View Transitions), если система не просит меньше движения
    if (document.startViewTransition && S.tab && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(() => applyTab(tab));
    } else applyTab(tab);
  }
  function applyTab(tab) {
    S.tab = tab;
    for (const t of ['monitoring', 'board', 'tasks']) {
      $('#tab-' + t).setAttribute('aria-selected', tab === t);
      $('#view-' + t).classList.toggle('hidden', tab !== t);
    }
    $('#board-tools').classList.toggle('hidden', tab !== 'board');
    $('#studio').classList.toggle('is-compact', tab === 'board');
    syncMonitoring();
    if (tab === 'board') requestAnimationFrame(() => { board.resize(); syncView(); });
  }
  $('#tab-monitoring').addEventListener('click', () => setTab('monitoring'));
  $('#tab-board').addEventListener('click', () => setTab('board'));
  $('#tab-tasks').addEventListener('click', () => setTab('tasks'));

  // Боковые панели на узком окне
  $('#toggle-left').addEventListener('click', () => { $('#app').classList.toggle('show-left'); $('#app').classList.remove('show-right'); });
  $('#toggle-right').addEventListener('click', () => { $('#app').classList.toggle('show-right'); $('#app').classList.remove('show-left'); chat.markSeen(); updateRightBadge(); });
  $('#center').addEventListener('mousedown', () => $('#app').classList.remove('show-left', 'show-right'));

  // ---------- Строка состояния ----------
  function setServerStatus(kind, text) {
    $('#server-dot').className = 'dot ' + (kind === 'ok' ? 'dot--positive' : kind === 'error' ? 'dot--live' : 'dot--warning dot--pulse');
    $('#server-text').textContent = text;
  }

  function lanLink() { return (S.links.find(l => l.kind === 'lan') || {}).url; }
  function publicLink() { return (S.links.find(l => l.kind === 'public') || {}).url; }

  function renderLinks() {
    const lan = lanLink();
    $('#lan-text').textContent = lan ? lan.replace('http://', '').replace(/\/\?.*$/, '') : 'нет сети';
    const pub = publicLink();
    const home = $('#status-home');
    home.classList.toggle('is-on', Boolean(pub));
    const st = S.tunnel.state;
    $('#home-text').textContent = pub ? 'Из дома: ' + pub.replace('https://', '').replace(/\/\?.*$/, '')
      : st === 'starting' ? 'Включаю доступ из дома…'
      : st === 'downloading' ? `Скачиваю модуль доступа… ${S.tunnel.progress || 0}%`
      : st === 'error' ? 'Доступ из дома: ошибка'
      : 'Доступ из дома выключен';
  }
  $('#status-lan').addEventListener('click', async () => { const l = lanLink(); if (l && await CC.copy(l)) toast('Адрес в локальной сети скопирован', { kind: 'positive', icon: 'copy' }); });
  $('#status-home').addEventListener('click', openInvite);
  api.onTunnel((t) => {
    const was = S.tunnel.state;
    S.tunnel = t;
    renderLinks();
    renderInvite();
    if (t.state === 'on' && was !== 'on') toast('Доступ из дома включён', { kind: 'positive', icon: 'globe' });
    if (t.state === 'error' && t.error) toast(t.error, { kind: 'warning' });
  });

  function updateCounts() {
    const n = S.agents.size, m = S.online.size;
    $('#status-pcs-n').textContent = n;
    $('#status-pcs').title = `${n} ${CC.plural(n, 'компьютер', 'компьютера', 'компьютеров')} класса на связи`;
    $('#status-online-n').textContent = m;
    $('#status-online').title = `${m} ${CC.plural(m, 'ученик', 'ученика', 'учеников')} онлайн`;
    $('#tab-pc-count').textContent = n;
    $('#count-class').textContent = n;
    $('#count-home').textContent = m;
  }

  // ---------- Приглашение ----------
  let inviteRefs = null;
  function openInvite() {
    const qr = el('div', { class: 'invite__qr' });
    const linkText = el('span', { class: 'link-box__url' });
    const copyBtn = el('button', { class: 'btn btn--sm', type: 'button' }, icon('copy', 'i-sm'), 'Копировать');
    const openBtn = el('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Открыть в браузере', 'aria-label': 'Открыть' }, icon('expand', 'i-sm'));
    const tunnelSwitch = el('input', { type: 'checkbox' });
    tunnelSwitch.checked = S.tunnel.state !== 'off';
    const tunnelHint = el('span', { class: 'switch__hint' });
    const note = el('div', { class: 'note' });
    const lanLine = el('span', { class: 'mono' });

    copyBtn.addEventListener('click', async () => { if (await CC.copy(inviteRefs.current)) toast('Ссылка скопирована', { kind: 'positive', icon: 'copy' }); });
    openBtn.addEventListener('click', () => api.openExternal(inviteRefs.current));
    tunnelSwitch.addEventListener('change', async () => { S.tunnel = await api.tunnel(tunnelSwitch.checked); renderLinks(); renderInvite(); });

    const codeEl = el('span', { class: 'code-box__code', text: S.lessonCode || '' });
    const newCode = el('button', { class: 'btn btn--sm btn--ghost', type: 'button', title: 'Старая ссылка перестанет работать' }, icon('restart', 'i-sm'), 'Новый код');
    newCode.addEventListener('click', async () => {
      if (!await CC.confirm('Сменить код урока?', 'Старые ссылки и QR-код перестанут работать. Тем, кто уже на уроке, ничего делать не нужно.', 'Сменить')) return;
      const c = await api.newLessonCode();
      if (c) { S.lessonCode = c; codeEl.textContent = c; }
    });
    const body = el('div', { class: 'invite' },
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: '0' } },
        el('div', { class: 'field' }, el('span', { class: 'field__label', text: 'Ссылка на урок' }),
          el('div', { class: 'link-box' }, linkText, openBtn, copyBtn)),
        el('div', { class: 'field' }, el('span', { class: 'field__label', text: 'Код урока — уже есть в ссылке, вводить нужно, только если ученик открыл адрес вручную' }),
          el('div', { class: 'code-box' }, codeEl, newCode)),
        el('label', { class: 'switch' },
          el('span', { class: 'switch__text' }, el('span', { class: 'switch__label', text: 'Доступ из дома через интернет' }), tunnelHint),
          tunnelSwitch, el('span', { class: 'switch__track' })),
        note,
        el('div', { class: 'field__hint' }, 'В классе по Wi-Fi: ', lanLine)),
      qr);
    inviteRefs = { qr, linkText, tunnelHint, note, lanLine, current: '' };
    renderInvite();
    CC.dialog({ title: 'Пригласить на урок', sub: 'Ученики открывают ссылку в браузере и вводят имя — ничего устанавливать не нужно.', body, wide: true })
      .then(() => { inviteRefs = null; });
  }

  function renderInvite() {
    if (!inviteRefs) return;
    const pub = publicLink(), lan = lanLink();
    const url = pub || lan || BASE;
    inviteRefs.current = url;
    inviteRefs.linkText.textContent = url;
    inviteRefs.lanLine.textContent = lan || '—';
    const st = S.tunnel.state;
    inviteRefs.tunnelHint.textContent = st === 'on' ? 'Включён — ссылка работает из любой сети'
      : st === 'starting' ? 'Подключаюсь…'
      : st === 'downloading' ? `Скачиваю модуль доступа (≈30 МБ, один раз)… ${S.tunnel.progress || 0}%`
      : st === 'error' ? (S.tunnel.error || 'Ошибка')
      : 'Бесплатно, без регистрации и аренды серверов';
    inviteRefs.note.className = 'note' + (st === 'error' ? ' note--warning' : '');
    inviteRefs.note.replaceChildren(icon(st === 'error' ? 'alert' : 'info', 'i-sm'), el('span', {
      text: pub ? 'Ссылка новая при каждом включении. Видео идёт напрямую между компьютерами; если сеть ученика не пускает — автоматически включится запасной режим.'
        : 'Сейчас ссылка открывается только в сети школы. Включите переключатель — появится ссылка, которая работает из любой сети, пока открыто приложение.'
    }));
    inviteRefs.qr.replaceChildren();
    inviteRefs.qr.classList.remove('is-empty');
    try {
      const q = qrcode(0, 'M');
      q.addData(url);
      q.make();
      inviteRefs.qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) {
      inviteRefs.qr.classList.add('is-empty');
      inviteRefs.qr.textContent = 'QR-код недоступен';
    }
  }
  $('#invite-btn').addEventListener('click', openInvite);

  // ---------- Участники ----------
  let goneBatch = [];
  let goneTimer = null;
  function applyRoster({ agents, online, offline }) {
    const prevAgents = S.agents;
    const joined = S.joined || (S.joined = { names: [], at: 0 });
    S.agents = new Map(agents.map(a => [a.id, a]));
    S.online = new Map(online.map(u => [u.id, u]));
    S.offline = new Map((offline || []).map(a => [a.host, a]));
    // Кто пропал во время урока — сообщаем одной строкой, если сразу несколько
    if (S.ready) {
      const hosts = new Set(agents.map(a => a.host));
      for (const a of prevAgents.values()) if (!hosts.has(a.host)) goneBatch.push(a.name);
      if (goneBatch.length && !goneTimer) goneTimer = setTimeout(() => {
        const n = goneBatch.length;
        toast(n === 1 ? `${goneBatch[0]} отключился` : `${n} ${CC.plural(n, 'компьютер отключился', 'компьютера отключились', 'компьютеров отключились')}`, { kind: 'warning', icon: 'power-off' });
        goneBatch = []; goneTimer = null;
      }, 2500);
    }
    for (const id of [...S.selected]) if (!S.agents.has(id)) S.selected.delete(id);
    for (const id of [...S.shots.keys()]) if (!S.agents.has(id)) S.shots.delete(id);
    if (prevAgents.size && agents.length > prevAgents.size) {
      const fresh = agents.filter(a => !prevAgents.has(a.id));
      // Утром класс включается разом — одно уведомление на всех, а не тридцать
      if (fresh.length) {
        if (Date.now() - joined.at > 6000) joined.names = [];
        joined.at = Date.now();
        joined.names.push(...fresh.map(a => a.name));
        const n = joined.names.length;
        toast(n === 1 ? `${joined.names[0]} подключился`
          : `Подключились: ${joined.names.slice(0, 3).join(', ')}${n > 3 ? ` и ещё ${n - 3}` : ''}`, { icon: 'monitor', group: 'joined' });
      }
    }
    renderGrid();
    renderPeople();
    updateCounts();
    Broadcast.syncViewers();
  }

  $$('[data-people]').forEach(b => b.addEventListener('click', () => {
    S.peopleTab = b.dataset.people;
    $$('[data-people]').forEach(x => x.classList.toggle('is-active', x === b));
    renderPeople();
  }));

  function renderPeople() {
    const list = $('#people-list');
    list.replaceChildren();
    const hands = [...S.online.values(), ...S.agents.values()].filter(u => u.hand);
    $('#hands-badge').classList.toggle('hidden', !hands.length);
    $('#hands-count').textContent = hands.length;
    updateRightBadge();

    if (S.peopleTab === 'class') {
      const agents = [...S.agents.values()].sort((a, b) => (Boolean(b.hand) - Boolean(a.hand)) || a.name.localeCompare(b.name, 'ru', { numeric: true }));
      if (!agents.length) {
        list.appendChild(el('li', { class: 'empty' }, el('div', { class: 'empty__text', text: 'Пока ни один компьютер класса не подключён.' })));
        return;
      }
      agents.forEach(a => list.appendChild(el('li', { class: 'row person' },
        el('span', { class: 'avatar', style: { '--av-bg': 'var(--active)', '--av-ink': 'var(--muted)' } }, icon('monitor', 'i-sm')),
        el('div', { class: 'row__main' },
          el('span', { class: 'row__title', text: a.student || 'Не представился' }),
          el('span', { class: 'row__sub' }, a.hand ? handMark() : el('span', { class: 'dot ' + (a.locked ? 'dot--warning' : a.idle >= 180 ? '' : 'dot--positive') }),
            a.hand ? `${a.name}, поднял руку` : `${a.name}, ${a.locked ? 'заблокирован' : CC.idleText(a.idle || 0)}`)),
        el('div', { class: 'row__actions' },
          el('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Подключиться', 'aria-label': 'Подключиться', onclick: () => openViewer(a.id) }, icon('pointer', 'i-sm')),
          a.hand ? el('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Опустить руку', 'aria-label': 'Опустить руку', onclick: () => socket.emit('lower-hand', { id: a.id }) }, icon('check', 'i-sm')) : null,
          el('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Кто сидит за этим ПК', 'aria-label': 'Кто сидит', onclick: () => assignSeat(a.id) }, icon('user', 'i-sm')),
          el('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Написать лично', 'aria-label': 'Написать лично', onclick: () => chat.setRecipient({ id: a.id, name: a.student || a.name }) }, icon('chat', 'i-sm'))))));
      return;
    }

    const users = [...S.online.values()].sort((a, b) => (b.hand - a.hand) || a.name.localeCompare(b.name, 'ru'));
    if (!users.length) {
      list.appendChild(el('li', { class: 'empty' },
        el('div', { class: 'empty__text', text: 'Ученики из дома появятся здесь, когда откроют ссылку на урок.' }),
        el('button', { class: 'btn btn--sm', type: 'button', onclick: openInvite }, icon('link', 'i-sm'), 'Пригласить')));
      return;
    }
    users.forEach(u => {
      const sub = u.hand ? [handMark(), 'поднял руку']
        : u.voice ? [icon('mic', 'i-sm'), 'говорит']
        : u.sharing ? [icon('share', 'i-sm'), 'показывает экран']
        : [u.remote ? 'из дома' : 'в сети школы'];
      const voiceBtn = el('button', {
        class: 'icon-btn icon-btn--sm' + (u.voice ? ' is-on' : ''), type: 'button',
        title: u.voice ? 'Выключить микрофон ученика' : 'Дать слово', 'aria-label': 'Микрофон',
        onclick: () => socket.emit('teacher-voice', { userId: u.id, on: !u.voice })
      }, icon(u.voice ? 'mic' : 'mic-off', 'i-sm'));
      const actions = el('div', { class: 'row__actions' + (u.hand || u.voice || u.sharing ? ' is-pinned' : '') },
        u.sharing ? el('button', { class: 'btn btn--sm btn--accent', type: 'button', onclick: () => openShareViewer(u.id) }, icon('eye', 'i-sm'), 'Смотреть') : null,
        voiceBtn,
        el('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Ещё', 'aria-label': 'Ещё', onclick: (e) => CC.menu(e.currentTarget, [
          { icon: 'chat', label: 'Написать лично', run: () => chat.setRecipient({ id: u.id, name: u.name }) },
          u.hand ? { icon: 'raise', label: 'Опустить руку', run: () => socket.emit('teacher-voice', { userId: u.id, on: false }) } : null,
          '-',
          { icon: 'door', label: 'Отключить', run: async () => { if (await CC.confirm(`Отключить ${u.name}?`, 'Ученик сможет зайти снова по ссылке — например, если зашёл не туда.', 'Отключить')) socket.emit('teacher-kick', { userId: u.id }); } },
          { icon: 'lock', label: 'Не пускать до конца урока', danger: true, run: async () => { if (await CC.confirm(`Не пускать ${u.name} до конца урока?`, 'Под этим именем на урок не зайти до «Завершить урок». Блокировка снимается с новым уроком.', 'Не пускать', 'danger')) socket.emit('teacher-kick', { userId: u.id, ban: true }); } }
        ], { alignRight: true }) }, icon('more', 'i-sm')));
      list.appendChild(el('li', { class: 'row person' + (u.hand ? ' is-hand' : '') },
        CC.avatar(u.name),
        el('div', { class: 'row__main' }, el('span', { class: 'row__title', text: u.name }), el('span', { class: 'row__sub' }, ...sub)),
        actions));
    });
  }

  socket.on('hand-raised', ({ id, name, inClass }) => {
    // В классе слово даёт сам учитель вслух; ученику из дома нужен микрофон
    toast(`${name} поднял руку`, { kind: 'accent', finger: 'up', motion: 'raise', duration: 7000, action: inClass
      ? { label: 'Опустить руку', run: () => socket.emit('lower-hand', { id }) }
      : { label: 'Дать слово', run: () => socket.emit('teacher-voice', { userId: id, on: true }) } });
  });

  // Поднятая рука — маленькая «указка» вверх: тот же знак, что у ученика на кнопке
  function handMark() { return CC.finger ? CC.finger({ point: 'up', size: 18, class: 'person__hand' }) : icon('raise', 'i-sm person__hand'); }

  function updateRightBadge() {
    const hands = [...S.online.values(), ...S.agents.values()].filter(u => u.hand).length;
    const n = hands + (chat ? chat.unseen : 0);
    const b = $('#right-badge');
    b.textContent = n;
    b.classList.toggle('hidden', !n || $('#app').classList.contains('show-right'));
  }

  // ---------- Мониторинг ----------
  $$('[data-size]').forEach(b => b.addEventListener('click', () => {
    $$('[data-size]').forEach(x => x.classList.toggle('is-active', x === b));
    $('#pc-grid').dataset.size = b.dataset.size;
  }));
  $('#pc-search').addEventListener('input', (e) => { S.filter = e.target.value.trim().toLowerCase(); renderGrid(); });
  $('#search-btn').addEventListener('click', () => { $('#search').classList.add('is-open'); $('#pc-search').focus(); });
  $('#pc-search').addEventListener('blur', () => { if (!$('#pc-search').value) $('#search').classList.remove('is-open'); });
  $('#pc-search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; S.filter = ''; renderGrid(); e.target.blur(); } });

  function visibleAgents() {
    return [...S.agents.values()]
      .filter(a => !S.filter || a.name.toLowerCase().includes(S.filter) || (a.host || '').toLowerCase().includes(S.filter))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  }

  function visibleOffline() {
    return [...(S.offline || new Map()).values()]
      .filter(a => !S.filter || a.name.toLowerCase().includes(S.filter) || a.host.toLowerCase().includes(S.filter))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  }

  function renderGrid() {
    const grid = $('#pc-grid');
    const list = visibleAgents();
    const off = visibleOffline();
    $('#pc-empty').classList.toggle('hidden', S.agents.size > 0 || (S.offline && S.offline.size > 0));
    const keep = new Set([...list.map(a => a.id), ...off.map(a => 'off:' + a.host)]);
    $$('.pc', grid).forEach(card => { if (!keep.has(card.dataset.id)) card.remove(); });
    let i = 0;
    list.forEach((a) => {
      let card = grid.querySelector(`.pc[data-id="${CSS.escape(a.id)}"]`);
      if (!card) {
        card = buildCard(a);
        if (S.ready) card.classList.add('is-new');
        // Тот же компьютер вернулся — показываем его прошлый кадр, пока не придёт новый
        const last = S.lastShot && S.lastShot.get(a.host);
        if (last) { const img = card.querySelector('.pc__screen img'); img.src = last; img.classList.remove('hidden'); card.querySelector('.pc__screen .empty')?.remove(); }
      }
      updateCard(card, a);
      if (grid.children[i] !== card) grid.insertBefore(card, grid.children[i] || null);
      i++;
    });
    off.forEach((a) => {
      let card = grid.querySelector(`.pc[data-id="${CSS.escape('off:' + a.host)}"]`);
      if (!card) card = buildOfflineCard(a);
      card.querySelector('.pc__status-text').textContent = 'не в сети с ' + CC.clock(a.lastSeen);
      if (grid.children[i] !== card) grid.insertBefore(card, grid.children[i] || null);
      i++;
    });
    updateSelectionUi();
  }

  function buildOfflineCard(a) {
    const last = S.lastShot && S.lastShot.get(a.host);
    return el('article', { class: 'pc is-offline', 'data-id': 'off:' + a.host },
      el('div', { class: 'pc__screen' },
        last ? el('img', { src: last, alt: '', draggable: 'false' }) : null,
        el('div', { class: 'pc__offline' }, icon('power-off'), 'Агент не на связи')),
      el('div', { class: 'pc__foot' },
        el('div', { class: 'pc__meta' },
          el('span', { class: 'pc__name', text: a.name, title: a.host }),
          el('span', { class: 'pc__status' }, el('span', { class: 'dot' }), el('span', { class: 'pc__status-text' }))),
        el('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Убрать из списка', 'aria-label': 'Убрать ' + a.name, onclick: async () => {
          if (await CC.confirm(`Убрать ${a.name} из списка?`, 'Карточка появится снова, когда агент на этом компьютере подключится.', 'Убрать')) socket.emit('forget-agent', { host: a.host });
        } }, icon('x', 'i-sm'))));
  }

  function buildCard(a) {
    const check = el('input', { type: 'checkbox', 'aria-label': 'Выбрать ' + a.name });
    check.addEventListener('change', () => { toggleSelect(a.id, check.checked); });
    const card = el('article', { class: 'pc', 'data-id': a.id },
      el('div', { class: 'pc__screen', title: 'Открыть экран' },
        el('img', { alt: '', draggable: 'false', class: 'hidden' }),
        el('div', { class: 'empty' }, icon('monitor'), el('span', { class: 'empty__text', text: 'Жду изображение…' })),
        el('label', { class: 'check pc__check', onclick: (e) => e.stopPropagation() }, check, el('span', { class: 'check__box' }, icon('check', 'i-sm'))),
        el('div', { class: 'pc__hover' },
          el('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Заблокировать / разблокировать', 'aria-label': 'Блокировка', 'data-lock': '', onclick: (e) => { e.stopPropagation(); const ag = S.agents.get(a.id); control([a.id], ag && ag.locked ? 'unlock' : 'lock'); } }, icon('lock', 'i-sm')),
          el('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Ещё', 'aria-label': 'Ещё', onclick: (e) => { e.stopPropagation(); cardMenu(e.currentTarget, a.id); } }, icon('more', 'i-sm')))),
      el('div', { class: 'pc__foot' },
        el('div', { class: 'pc__meta' },
          el('span', { class: 'pc__name' }),
          el('span', { class: 'pc__status' }, el('span', { class: 'dot' }), el('span', { class: 'pc__status-text' }))),
        el('button', { class: 'icon-btn icon-btn--sm pc__go', type: 'button', title: 'Подключиться и управлять', 'aria-label': 'Управлять ' + a.name, onclick: () => openViewer(a.id) }, icon('pointer', 'i-sm'))));
    card.querySelector('.pc__screen').addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) { toggleSelect(a.id, !S.selected.has(a.id)); return; }
      openViewer(a.id);
    });
    return card;
  }

  function updateCard(card, a) {
    const nameEl = card.querySelector('.pc__name');
    nameEl.replaceChildren(a.student || a.name);
    if (a.student) nameEl.appendChild(el('span', { class: 'pc__pc', text: a.name }));
    card.classList.toggle('is-hand', Boolean(a.hand));
    nameEl.title = [a.student, a.name, a.host !== a.name ? a.host : null, a.ip].filter(Boolean).join(', ');
    const idle = a.idle || 0;
    card.querySelector('.pc__status .dot').className = 'dot ' + (a.locked ? 'dot--warning' : idle >= 180 ? '' : 'dot--positive');
    card.querySelector('.pc__status-text').textContent = a.locked ? 'заблокирован' : CC.idleText(idle);
    card.classList.toggle('is-selected', S.selected.has(a.id));
    card.querySelector('.pc__check input').checked = S.selected.has(a.id);
    card.classList.toggle('is-alert', Boolean(a.focusHit));
    let alertEl = card.querySelector('.pc__alert');
    if (a.focusHit) {
      if (!alertEl) { alertEl = el('div', { class: 'pc__alert' }, icon('target', 'i-sm'), el('span')); card.querySelector('.pc__screen').appendChild(alertEl); }
      alertEl.querySelector('span').textContent = a.focusHit;
      alertEl.title = a.focusHit;
    } else if (alertEl) alertEl.remove();
    let veil = card.querySelector('.pc__veil');
    if (a.locked && !veil) card.querySelector('.pc__screen').appendChild(el('div', { class: 'pc__veil' }, icon('lock', 'i-sm'), 'Экран заблокирован'));
    if (!a.locked && veil) veil.remove();
    const lockBtn = card.querySelector('[data-lock] use');
    if (lockBtn) lockBtn.setAttribute('href', a.locked ? '#i-unlock' : '#i-lock');
  }

  socket.on('agent-screenshot', ({ agentId, image, idle }) => {
    const a = S.agents.get(agentId);
    if (!a) return;
    const prevIdle = a.idle;
    a.idle = idle;
    const card = document.querySelector(`.pc[data-id="${CSS.escape(agentId)}"]`);
    if (!card) return;
    const blob = new Blob([image], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = card.querySelector('.pc__screen img');
    img.onload = () => {
      // Последний кадр храним по имени компьютера: он пригодится, если ПК отключится
      if (!S.lastShot) S.lastShot = new Map();
      const prev = S.lastShot.get(a.host);
      if (prev && prev !== url) URL.revokeObjectURL(prev);
      S.lastShot.set(a.host, url);
      S.shots.set(agentId, url);
    };
    img.src = url;
    img.classList.remove('hidden');
    card.querySelector('.pc__screen .empty')?.remove();
    if ((prevIdle >= 60) !== (idle >= 60) || Math.floor(prevIdle / 60) !== Math.floor(idle / 60)) updateCard(card, a);
  });

  function toggleSelect(id, on) {
    if (on) S.selected.add(id); else S.selected.delete(id);
    const card = document.querySelector(`.pc[data-id="${CSS.escape(id)}"]`);
    if (card) { card.classList.toggle('is-selected', on); card.querySelector('.pc__check input').checked = on; }
    updateSelectionUi();
  }

  $('#select-all').addEventListener('change', (e) => {
    const on = e.target.checked;
    visibleAgents().forEach(a => toggleSelect(a.id, on));
  });

  function targets() { return S.selected.size ? [...S.selected] : [...S.agents.keys()]; }

  function updateSelectionUi() {
    const n = S.selected.size, total = S.agents.size;
    const all = $('#select-all');
    all.checked = n > 0 && n === total;
    all.indeterminate = n > 0 && n < total;
    $('#selection-label').textContent = n ? `Выбрано ${n} из ${total}` : total ? `${total} ${CC.plural(total, 'компьютер', 'компьютера', 'компьютеров')} на связи` : 'Компьютеры класса';
    $('#pc-actions').classList.toggle('is-idle', total === 0);
    $('#pc-grid').classList.toggle('has-selection', n > 0);
    const lockAllBtn = $('[data-act="lock"]');
    lockAllBtn.title = n ? 'Заблокировать выбранные' : 'Заблокировать все';
  }

  function control(ids, action, data) {
    if (!ids.length) return;
    socket.emit('agent-control', { agentIds: ids, action, data: data || {} });
  }

  function who(ids) {
    if (ids.length === 1) return (S.agents.get(ids[0]) || {}).name || '1 компьютер';
    return `${ids.length} ${CC.plural(ids.length, 'компьютер', 'компьютера', 'компьютеров')}`;
  }

  async function actMessage(ids) {
    const text = await CC.prompt({ title: 'Сообщение на экран', sub: who(ids), label: 'Текст', placeholder: 'Например: сохраните работу, через 5 минут проверка', multiline: true, okLabel: 'Отправить' });
    if (text) { control(ids, 'message', { text }); toast('Сообщение отправлено', { kind: 'positive', icon: 'bell' }); }
  }

  async function actOpenUrl(ids) {
    let url = await CC.prompt({ title: 'Открыть сайт у учеников', sub: who(ids), label: 'Адрес', placeholder: 'https://…', okLabel: 'Открыть' });
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    control(ids, 'open-url', { url });
    toast('Сайт открывается у учеников', { kind: 'positive', icon: 'globe' });
  }

  async function actLock(ids) {
    control(ids, 'lock', { text: 'Внимание на учителя' });
  }

  async function actPower(ids, mode) {
    const label = { shutdown: 'Выключить', restart: 'Перезагрузить', logoff: 'Завершить сеанс' }[mode];
    const ok = await CC.confirm(`${label}: ${who(ids)}?`, 'Несохранённая работа учеников может пропасть.', label, 'danger');
    if (ok) control(ids, 'power', { mode });
  }

  $$('#pc-actions [data-act]').forEach(b => b.addEventListener('click', (e) => {
    const ids = targets();
    const act = b.dataset.act;
    if (act === 'lock') actLock(ids);
    if (act === 'unlock') control(ids, 'unlock');
    if (act === 'message') actMessage(ids);
    if (act === 'open-url') actOpenUrl(ids);
    if (act === 'more') CC.menu(e.currentTarget, [
      { icon: 'power', label: 'Выключить', danger: true, run: () => actPower(ids, 'shutdown') },
      { icon: 'restart', label: 'Перезагрузить', run: () => actPower(ids, 'restart') },
      { icon: 'logout', label: 'Завершить сеанс', run: () => actPower(ids, 'logoff') }
    ], { alignRight: true });
  }));

  function cardMenu(anchor, id) {
    const a = S.agents.get(id);
    if (!a) return;
    CC.menu(anchor, [
      { icon: 'pointer', label: 'Подключиться к экрану', run: () => openViewer(id) },
      { icon: 'user', label: a.student ? 'Пересадить: кто теперь за этим ПК' : 'Кто сидит за этим ПК', run: () => assignSeat(id) },
      a.student ? { icon: 'x', label: 'Освободить место', run: () => socket.emit('seat-assign', { agentId: id, name: null }) } : null,
      { icon: 'list', label: 'Запущенные программы', run: () => openProcesses(id) },
      { icon: 'bell', label: 'Сообщение на экран', run: () => actMessage([id]) },
      { icon: 'chat', label: 'Написать в чат лично', run: () => chat.setRecipient({ id, name: a.name }) },
      { icon: 'globe', label: 'Открыть сайт', run: () => actOpenUrl([id]) },
      '-',
      { icon: 'restart', label: 'Перезагрузить', run: () => actPower([id], 'restart') },
      { icon: 'power', label: 'Выключить', danger: true, run: () => actPower([id], 'shutdown') },
      '-',
      { icon: 'door', label: 'Это не мой компьютер', run: async () => {
        if (await CC.confirm(`Отпустить ${a.name}?`, 'Компьютер отключится от вас и найдёт учителя своего кабинета. Пригодится, если он попал сюда из соседнего класса.', 'Отпустить')) socket.emit('release-agent', { agentId: id });
      } }
    ], { alignRight: true });
  }

  socket.on('agent-control-result', (r) => {
    if (!r.ok) toast(`${(S.agents.get(r.agentId) || {}).name || 'ПК'}: ${r.message || 'команда не выполнена'}`, { kind: 'warning' });
  });

  // ---------- Запущенные программы ----------
  let procWaiter = null;
  socket.on('agent-processes', (d) => { if (procWaiter && procWaiter.id === d.agentId) procWaiter.render(d.list); });

  function openProcesses(id) {
    const a = S.agents.get(id);
    if (!a) return;
    const list = el('ul', { class: 'procs' }, el('li', null, el('span', { class: 'spinner' }), el('span', { class: 'muted', text: 'Получаю список…' })));
    const render = (items) => {
      list.replaceChildren();
      if (!items.length) { list.appendChild(el('li', null, el('span', { class: 'muted', text: 'Открытых программ нет' }))); return; }
      items.forEach(p => {
        const li = el('li', null,
          el('div', { class: 'procs__main' }, el('span', { class: 'procs__title', text: p.title || p.name }), el('span', { class: 'procs__name', text: p.name + (p.pid ? ' · ' + p.pid : '') })),
          el('button', { class: 'btn btn--sm btn--danger', type: 'button', onclick: async () => {
            control([id], 'kill', { pid: p.pid, name: p.name });
            li.style.opacity = '.4';
            setTimeout(() => control([id], 'list-processes'), 900);
          } }, 'Закрыть'));
        list.appendChild(li);
      });
    };
    procWaiter = { id, render };
    control([id], 'list-processes');
    const refresh = el('button', { class: 'btn btn--sm', type: 'button', onclick: () => control([id], 'list-processes') }, icon('restart', 'i-sm'), 'Обновить');
    CC.dialog({ title: 'Программы на ' + a.name, sub: 'Окна, открытые у ученика. «Закрыть» завершает программу сразу.', body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, list, el('div', null, refresh)), wide: true })
      .then(() => { procWaiter = null; });
  }

  // ---------- Просмотр экрана: компьютер класса или ученик из дома ----------
  const Viewer = { mode: null, id: null, peer: null, stream: null, control: false };

  function openViewer(agentId) {
    const a = S.agents.get(agentId);
    if (!a) return;
    closeViewer(true);
    Object.assign(Viewer, { mode: 'remote', id: agentId, control: false });
    $('#viewer-name').textContent = a.name;
    $('#viewer-state').textContent = 'Подключение…';
    $('#viewer-control').checked = false;
    $('#viewer-control-wrap').classList.remove('hidden');
    $('#viewer-procs').classList.remove('hidden');
    $('#viewer-lock').classList.remove('hidden');
    $('#viewer-lock span').textContent = a.locked ? 'Разблокировать' : 'Заблокировать';
    $('#viewer-wait').classList.remove('hidden');
    $('#viewer-wait-text').textContent = 'Подключаюсь к экрану…';
    $('#viewer-video').srcObject = null;
    $('#viewer').classList.remove('hidden');
    setControl(false);
    socket.emit('remote-start', { agentId, quality: 'high' });
    Viewer.timeout = setTimeout(() => {
      if (!Viewer.stream) $('#viewer-wait-text').textContent = 'Компьютер не отвечает. Проверьте, что агент запущен.';
    }, 8000);
  }

  function openShareViewer(userId) {
    const u = S.online.get(userId);
    if (!u) return;
    closeViewer(true);
    Object.assign(Viewer, { mode: 'share', id: userId, control: false });
    $('#viewer-name').textContent = u.name;
    $('#viewer-state').textContent = 'Показывает свой экран';
    $('#viewer-control-wrap').classList.add('hidden');
    $('#viewer-procs').classList.add('hidden');
    $('#viewer-lock').classList.add('hidden');
    $('#viewer-wait').classList.remove('hidden');
    $('#viewer-wait-text').textContent = 'Жду изображение от ученика…';
    $('#viewer-video').srcObject = null;
    $('#viewer').classList.remove('hidden');
    setControl(false);
    let showAll = $('#viewer-showall');
    if (!showAll) {
      showAll = el('button', { class: 'btn btn--sm', id: 'viewer-showall', type: 'button' }, icon('cast', 'i-sm'), el('span', { text: 'Показать всем' }));
      $('#viewer-actions').insertBefore(showAll, $('#viewer-close'));
      showAll.addEventListener('click', () => {
        if (!Viewer.stream) return;
        Broadcast.showExternal(Viewer.stream, Viewer.id);
        showAll.classList.add('is-on');
        showAll.querySelector('span').textContent = 'Показывается всем';
      });
    }
    showAll.classList.remove('hidden', 'is-on');
    showAll.querySelector('span').textContent = 'Показать всем';
    socket.emit('teacher-accept-share', { userId });
  }

  function closeViewer(silent) {
    clearTimeout(Viewer.timeout);
    if (Viewer.mode === 'remote' && Viewer.id) socket.emit('remote-stop', { agentId: Viewer.id });
    if (Viewer.mode === 'share' && Viewer.id && !silent) socket.emit('teacher-close-share', { userId: Viewer.id });
    if (Viewer.mode === 'share' && Broadcast.externalFrom === Viewer.id) Broadcast.restoreOwn();
    if (Viewer.peer) Viewer.peer.close();
    Object.assign(Viewer, { mode: null, id: null, peer: null, stream: null });
    setControl(false);
    $('#viewer-video').srcObject = null;
    $('#viewer').classList.add('hidden');
    $('#viewer-showall')?.classList.add('hidden');
  }
  $('#viewer-close').addEventListener('click', () => closeViewer(false));
  $('#viewer-back').addEventListener('click', () => closeViewer(false));
  $('#viewer-procs').addEventListener('click', () => Viewer.id && openProcesses(Viewer.id));
  $('#viewer-lock').addEventListener('click', () => {
    const a = S.agents.get(Viewer.id);
    if (!a) return;
    control([a.id], a.locked ? 'unlock' : 'lock', { text: 'Внимание на учителя' });
  });
  $('#viewer-control').addEventListener('change', (e) => setControl(e.target.checked));

  function setControl(on) {
    Viewer.control = on && Viewer.mode === 'remote';
    $('#viewer-control').checked = Viewer.control;
    $('#viewer-stage').classList.toggle('is-control', Viewer.control);
    $('#viewer-hint').classList.toggle('hidden', !Viewer.control);
    if (Viewer.control) $('#viewer-stage').focus();
  }

  // Ввод: координаты считаем по реальной картинке внутри видео (без чёрных полей)
  function videoPoint(e) {
    const v = $('#viewer-video');
    const r = v.getBoundingClientRect();
    const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
    const scale = Math.min(r.width / vw, r.height / vh);
    const w = vw * scale, h = vh * scale;
    const x = (e.clientX - r.left - (r.width - w) / 2) / w;
    const y = (e.clientY - r.top - (r.height - h) / 2) / h;
    return { x, y, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
  }
  function sendInput(data) {
    if (Viewer.control && Viewer.id) socket.emit('agent-control', { agentIds: [Viewer.id], action: 'input', data });
  }
  let moveQueued = null;
  const stage = $('#viewer-stage');
  stage.addEventListener('pointermove', (e) => {
    if (!Viewer.control) return;
    const p = videoPoint(e);
    if (!p.inside) return;
    if (!moveQueued) requestAnimationFrame(() => { sendInput({ type: 'move', x: moveQueued.x, y: moveQueued.y }); moveQueued = null; });
    moveQueued = p;
  });
  stage.addEventListener('pointerdown', (e) => {
    if (!Viewer.control) return;
    const p = videoPoint(e);
    if (!p.inside) return;
    e.preventDefault();
    stage.focus();
    sendInput({ type: 'down', x: p.x, y: p.y, button: e.button });
  });
  stage.addEventListener('pointerup', (e) => {
    if (!Viewer.control) return;
    const p = videoPoint(e);
    sendInput({ type: 'up', x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)), button: e.button });
  });
  stage.addEventListener('contextmenu', (e) => { if (Viewer.control) e.preventDefault(); });
  stage.addEventListener('wheel', (e) => {
    if (!Viewer.control) return;
    e.preventDefault();
    sendInput({ type: 'wheel', dx: Math.sign(e.deltaX) * Math.min(10, Math.ceil(Math.abs(e.deltaX) / 40)), dy: Math.sign(e.deltaY) * Math.min(10, Math.ceil(Math.abs(e.deltaY) / 40)) });
  }, { passive: false });
  const keyHandler = (down) => (e) => {
    if (!Viewer.control) return;
    if (e.key === 'Escape' && down && !e.ctrlKey && !e.altKey) { setControl(false); return; }
    e.preventDefault();
    sendInput({ type: 'key', down, code: e.code, key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
  };
  stage.addEventListener('keydown', keyHandler(true));
  stage.addEventListener('keyup', keyHandler(false));

  // ---------- WebRTC: входящие сигналы ----------
  const voicePeers = new Map(); // userId -> { peer, audio, node }

  socket.on('signal', async ({ source, kind, type, payload }) => {
    try {
      if (kind === 'broadcast') return Broadcast.onSignal(source, type, payload);
      if (kind === 'remote' || kind === 'share') {
        if (source !== Viewer.id) return;
        if (type === 'offer') {
          if (Viewer.peer) Viewer.peer.close();
          Viewer.peer = CC.answerPeer({
            socket, source, kind,
            onTrack: (stream) => {
              Viewer.stream = stream;
              $('#viewer-video').srcObject = stream;
              $('#viewer-wait').classList.add('hidden');
              if (kind === 'remote') $('#viewer-state').textContent = 'На связи';
            },
            onState: (st) => {
              if (st === 'failed' || st === 'disconnected') {
                $('#viewer-wait').classList.remove('hidden');
                $('#viewer-wait-text').textContent = 'Связь прервалась…';
              }
            }
          });
          await Viewer.peer.offer(payload);
        } else if (type === 'ice' && Viewer.peer) {
          await Viewer.peer.ice(payload);
        }
        return;
      }
      if (kind === 'voice') {
        if (type === 'offer') {
          const old = voicePeers.get(source);
          if (old) { old.peer.close(); Mixer.remove(old.node); }
          const entry = { peer: null, audio: new Audio(), node: null };
          entry.peer = CC.answerPeer({
            socket, source, kind: 'voice',
            onTrack: (stream) => {
              entry.audio.srcObject = stream;
              entry.audio.play().catch(() => {});
              entry.node = Mixer.addRemote(stream);
            }
          });
          voicePeers.set(source, entry);
          await entry.peer.offer(payload);
        } else if (type === 'ice') {
          const v = voicePeers.get(source);
          if (v) await v.peer.ice(payload);
        }
      }
    } catch (err) {
      console.error('[TEACHER] signal', kind, type, err);
    }
  });

  function dropVoice(id) {
    const v = voicePeers.get(id);
    if (!v) return;
    v.peer.close();
    v.audio.srcObject = null;
    Mixer.remove(v.node);
    voicePeers.delete(id);
  }

  socket.on('online-user-sharing', ({ userId, name }) => {
    toast(`${name} хочет показать экран`, { kind: 'accent', icon: 'share', duration: 10000, action: { label: 'Смотреть', run: () => openShareViewer(userId) } });
  });
  socket.on('online-user-stopped-sharing', ({ userId }) => {
    if (Viewer.mode === 'share' && Viewer.id === userId) {
      if (Broadcast.externalFrom === userId) Broadcast.restoreOwn();
      closeViewer(true);
      toast('Ученик закончил показ экрана');
    }
  });

  // ---------- Звук: микшер эфира ----------
  // Ученикам в классе — только звук компьютера (без эха микрофона в кабинете),
  // ученикам из дома — звук компьютера, микрофон учителя и голоса тех, кому дали слово.
  const Mixer = {
    ctx: null,
    init() {
      if (this.ctx) return;
      this.ctx = new AudioContext();
      this.toClass = this.ctx.createMediaStreamDestination();
      this.toHome = this.ctx.createMediaStreamDestination();
      this.toRecord = this.ctx.createMediaStreamDestination();
      // Тихий источник, чтобы дорожки существовали всегда
      const silent = this.ctx.createConstantSource();
      silent.offset.value = 0;
      silent.connect(this.toClass); silent.connect(this.toHome); silent.connect(this.toRecord);
      silent.start();
    },
    connect(stream, targets) {
      this.init();
      if (!stream || !stream.getAudioTracks().length) return null;
      const node = this.ctx.createMediaStreamSource(stream);
      targets.forEach(t => node.connect(this[t]));
      return node;
    },
    addRemote(stream) { return this.connect(stream, ['toHome', 'toRecord']); },
    remove(node) { if (node) { try { node.disconnect(); } catch (e) {} } },

    // Один микрофон на всё: в эфир (если включён переключатель) и в запись (пока она идёт)
    async updateMic() {
      this.init();
      const home = $('#opt-mic').checked && Broadcast.active;
      const rec = Recorder.active;
      if ((home || rec) && !this.micStream) {
        try {
          this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
          this.micSrc = this.ctx.createMediaStreamSource(this.micStream);
          this.gHome = this.ctx.createGain();
          this.gRec = this.ctx.createGain();
          this.micSrc.connect(this.gHome).connect(this.toHome);
          this.micSrc.connect(this.gRec).connect(this.toRecord);
        } catch (e) {
          toast('Микрофон недоступен', { kind: 'warning', icon: 'mic-off' });
          if (home) $('#opt-mic').checked = false;
          return;
        }
      }
      if (!this.micStream) return;
      this.gHome.gain.value = home ? 1 : 0;
      this.gRec.gain.value = rec ? 1 : 0;
      if (!home && !rec) {
        this.micStream.getTracks().forEach(t => t.stop());
        [this.micSrc, this.gHome, this.gRec].forEach(n => this.remove(n));
        this.micStream = null;
      }
    }
  };

  // ---------- Эфир ----------
  const Broadcast = {
    active: false,
    stream: null,          // захват экрана
    videoTrack: null,      // что сейчас уходит в эфир
    systemNode: null,
    peers: new Map(),      // viewerId -> peer
    startedAt: 0,
    sourceId: null,
    sourceName: 'Весь экран',
    externalFrom: null,

    async start() {
      const [w, h] = $('#quality').value.split('x').map(Number);
      const fps = Number($('#fps').value);
      try {
        await api.setShareSource(this.sourceId);
        this.stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: w, max: w }, height: { ideal: h, max: h }, frameRate: { ideal: fps, max: fps } },
          audio: $('#opt-audio').checked
        });
      } catch (err) {
        toast('Не удалось захватить экран: ' + (err.message || err.name), { kind: 'warning' });
        return;
      }
      Mixer.init();
      if (Mixer.ctx.state === 'suspended') Mixer.ctx.resume();
      this.videoTrack = this.stream.getVideoTracks()[0];
      this.videoTrack.contentHint = fps <= 15 ? 'detail' : 'motion';
      this.videoTrack.onended = () => this.stop();
      this.systemNode = Mixer.connect(this.stream, ['toClass', 'toHome', 'toRecord']);
      this.active = true;
      this.startedAt = Date.now();
      await Mixer.updateMic();
      $('#preview-video').srcObject = new MediaStream([this.videoTrack]);
      socket.emit('start-broadcast', { allowExit: $('#opt-exit').checked });
      api.keepAwake(true);
      this.render();
      toast('Эфир начался', { kind: 'live', icon: 'live' });
    },

    stop() {
      if (!this.active) return;
      this.active = false;
      for (const p of this.peers.values()) p.close();
      this.peers.clear();
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      Mixer.remove(this.systemNode);
      this.stream = null; this.videoTrack = null; this.systemNode = null; this.externalFrom = null;
      Mixer.updateMic();
      $('#preview-video').srcObject = null;
      socket.emit('stop-broadcast');
      api.keepAwake(false);
      Relay.stop();
      this.render();
    },

    streamFor(viewerId) {
      const audio = (S.online.has(viewerId) ? Mixer.toHome : Mixer.toClass).stream.getAudioTracks()[0];
      return new MediaStream([this.videoTrack, audio]);
    },

    bitrate() {
      const n = Math.max(1, this.peers.size);
      const [w] = $('#quality').value.split('x').map(Number);
      const top = w >= 1920 ? 4500 : w >= 1280 ? 2500 : w >= 854 ? 1200 : 700;
      // Ноутбук учителя кодирует поток для каждого зрителя: делим бюджет
      return Math.round(Math.max(350, Math.min(top, 40000 / n)));
    },

    async connect(ids) {
      if (!this.active) return;
      for (const id of ids) {
        if (this.peers.has(id)) this.peers.get(id).close();
        try {
          const peer = await CC.offerPeer({
            socket, target: id, kind: 'broadcast', stream: this.streamFor(id),
            onState: (st) => { if (st === 'failed') { this.peers.get(id)?.close(); this.peers.delete(id); this.render(); } }
          });
          this.peers.set(id, peer);
        } catch (e) {
          console.error('[TEACHER] peer', e);
        }
      }
      const kbps = this.bitrate();
      for (const p of this.peers.values()) CC.limitBitrate(p.pc, kbps);
      this.render();
    },

    async onSignal(source, type, payload) {
      const peer = this.peers.get(source);
      if (!peer) return;
      if (type === 'answer') await peer.answer(payload);
      else if (type === 'ice') await peer.ice(payload);
    },

    drop(id) {
      const p = this.peers.get(id);
      if (p) { p.close(); this.peers.delete(id); this.render(); }
    },

    syncViewers() { this.render(); },

    async replaceVideo(track) {
      this.videoTrack = track;
      for (const p of this.peers.values()) {
        const sender = p.pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) await sender.replaceTrack(track).catch(() => {});
      }
      $('#preview-video').srcObject = new MediaStream([track]);
    },

    async showExternal(stream, fromId) {
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      if (!this.active) {
        // Эфира ещё нет — начинаем его сразу с экраном ученика
        Mixer.init();
        this.active = true;
        this.startedAt = Date.now();
        this.ownTrack = null;
        this.videoTrack = track;
        $('#preview-video').srcObject = new MediaStream([track]);
        socket.emit('start-broadcast', { allowExit: $('#opt-exit').checked });
        api.keepAwake(true);
      } else {
        this.ownTrack = this.stream ? this.stream.getVideoTracks()[0] : null;
        await this.replaceVideo(track);
      }
      this.externalFrom = fromId;
      this.render();
    },

    async restoreOwn() {
      this.externalFrom = null;
      if (this.ownTrack && this.ownTrack.readyState === 'live') await this.replaceVideo(this.ownTrack);
      else if (!this.stream) this.stop();
      this.render();
    },

    render() {
      const live = this.active;
      const btn = $('#broadcast-btn');
      btn.className = 'btn btn--lg btn--block ' + (live ? 'btn--live' : 'btn--primary');
      btn.querySelector('use').setAttribute('href', live ? '#i-stop' : '#i-play');
      btn.querySelector('span').textContent = live ? 'Остановить эфир' : 'Начать эфир';
      $('#preview-empty').classList.toggle('hidden', live);
      $('#preview').classList.toggle('is-live', live);
      $('#preview-live').classList.toggle('hidden', !live);
      $('#live-badge').classList.toggle('hidden', !live);
      const n = this.peers.size;
      const total = Math.max(n, this.viewersTotal || 0);
      $('#viewers-meta').textContent = live ? `${total} ${CC.plural(total, 'зритель', 'зрителя', 'зрителей')}` : '';
      $('#viewers-meta').title = live && this.relayed ? `${this.relayed} компьютеров класса получают эфир друг от друга — так ноутбук учителя не перегружается` : '';
      $('#quality').disabled = live; $('#fps').disabled = live; $('#opt-audio').disabled = live;
    }
  };

  socket.on('peer-request', ({ ids }) => Broadcast.connect(ids));
  socket.on('viewers', ({ total, relayed }) => { Broadcast.viewersTotal = total; Broadcast.relayed = relayed; Broadcast.render(); });
  socket.on('peer-gone', ({ id }) => { Broadcast.drop(id); dropVoice(id); });

  setInterval(() => { if (Broadcast.active) $('#live-time').textContent = CC.duration(Date.now() - Broadcast.startedAt); }, 1000);

  $('#broadcast-btn').addEventListener('click', () => (Broadcast.active ? Broadcast.stop() : Broadcast.start()));
  $('#opt-mic').addEventListener('change', (e) => {
    api.saveSettings({ shareMic: e.target.checked });
    Mixer.updateMic();
  });
  $('#opt-exit').addEventListener('change', (e) => { api.saveSettings({ allowExit: e.target.checked }); if (Broadcast.active) socket.emit('start-broadcast', { allowExit: e.target.checked }); });
  $('#opt-audio').addEventListener('change', (e) => api.saveSettings({ shareAudio: e.target.checked }));
  $('#quality').addEventListener('change', (e) => api.saveSettings({ quality: e.target.value }));
  $('#fps').addEventListener('change', (e) => api.saveSettings({ fps: Number(e.target.value) }));

  $('#quality').value = settings.quality || '1280x720';
  $('#fps').value = String(settings.fps || 15);
  $('#opt-audio').checked = settings.shareAudio !== false && boot.platform === 'win32';
  if (boot.platform && boot.platform !== 'win32') { $('#opt-audio').disabled = true; $('#opt-audio').closest('.switch').title = 'Звук компьютера передаётся только в Windows'; }
  $('#opt-mic').checked = Boolean(settings.shareMic);
  $('#opt-exit').checked = Boolean(settings.allowExit);

  // Выбор источника
  async function pickSource() {
    const sources = await api.getSources();
    if (!sources.length) {
      toast(window.teacherAPI ? 'Не нашёл экранов и окон для показа' : 'Выбор источника доступен в приложении', { kind: 'warning' });
      return;
    }
    const grid = el('div', { class: 'sources' });
    let chosen = null;
    const groups = [['screen', 'Экраны'], ['window', 'Окна программ']];
    groups.forEach(([kind, label]) => {
      const items = sources.filter(s => s.kind === kind);
      if (!items.length) return;
      grid.appendChild(el('div', { class: 'sources__group', text: label }));
      items.forEach((s, idx) => {
        const name = kind === 'screen' ? (items.length > 1 ? `Экран ${idx + 1}` : 'Весь экран') : s.name;
        const node = el('button', { class: 'source' + (s.id === Broadcast.sourceId ? ' is-active' : ''), type: 'button' },
          el('span', { class: 'source__thumb' }, s.thumbnail ? el('img', { src: s.thumbnail, alt: '' }) : icon('monitor')),
          el('span', { class: 'source__name' }, s.icon ? el('img', { src: s.icon, alt: '' }) : null, el('span', { class: 'truncate', text: name })));
        node.addEventListener('click', () => {
          $$('.source', grid).forEach(x => x.classList.remove('is-active'));
          node.classList.add('is-active');
          chosen = { ...s, label: name };
        });
        node.addEventListener('dblclick', () => { chosen = { ...s, label: name }; $('.overlay .btn--primary')?.click(); });
        grid.appendChild(node);
      });
    });
    const ok = await CC.dialog({
      title: 'Что показать ученикам', sub: 'Выберите экран целиком или одно окно — например, презентацию.', body: grid, wide: true,
      actions: [{ label: 'Отмена', value: false }, { label: Broadcast.active ? 'Переключить' : 'Выбрать', kind: 'primary', primary: true, value: () => true }]
    });
    if (!ok || !chosen) return;
    Broadcast.sourceId = chosen.id;
    Broadcast.sourceName = chosen.label;
    $('#source-name').textContent = chosen.label;
    $('#source-thumb').replaceChildren(chosen.thumbnail ? el('img', { src: chosen.thumbnail, alt: '' }) : icon('monitor'));
    if (Broadcast.active && !Broadcast.externalFrom) {
      // Переключаем источник на лету, не прерывая эфир
      try {
        await api.setShareSource(chosen.id);
        const [w, h] = $('#quality').value.split('x').map(Number);
        const fps = Number($('#fps').value);
        const fresh = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: w, max: w }, height: { ideal: h, max: h }, frameRate: { ideal: fps, max: fps } }, audio: false });
        const track = fresh.getVideoTracks()[0];
        const old = Broadcast.videoTrack;
        track.onended = () => Broadcast.stop();
        await Broadcast.replaceVideo(track);
        if (old) { old.onended = null; old.stop(); }
        if (Broadcast.stream) Broadcast.stream.getVideoTracks().forEach(t => Broadcast.stream.removeTrack(t));
        if (Broadcast.stream) Broadcast.stream.addTrack(track);
        toast('Источник переключён', { kind: 'positive', icon: 'cast' });
      } catch (e) {
        toast('Не удалось переключить источник', { kind: 'warning' });
      }
    }
  }
  $('#source-btn').addEventListener('click', pickSource);
  $('#preview-empty').addEventListener('click', pickSource);

  // ---------- Запасной режим: кадры через сервер, если WebRTC из дома не пробился ----------
  const Relay = {
    timer: null, canvas: document.createElement('canvas'), count: 0,
    start() {
      if (this.timer) return;
      this.timer = setInterval(() => this.frame(), 250);
    },
    stop() { clearInterval(this.timer); this.timer = null; },
    frame() {
      const v = $('#preview-video');
      if (!Broadcast.active || !v.videoWidth) return;
      const w = Math.min(1280, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth);
      if (this.canvas.width !== w) { this.canvas.width = w; this.canvas.height = h; }
      this.canvas.getContext('2d').drawImage(v, 0, 0, w, h);
      this.canvas.toBlob(async (b) => { if (b) socket.emit('relay-frame', await b.arrayBuffer()); }, 'image/jpeg', 0.6);
    }
  };
  socket.on('relay-count', ({ count }) => { Relay.count = count; if (count > 0) Relay.start(); else Relay.stop(); });

  // ---------- Доска ----------
  const board = new CC.Board($('#board-stage'), $('#board'));
  window.__board = board;   // для проверок
  const COLORS = ['#111111', '#e5484d', '#f2a33a', '#2f9e6b', '#2f6fde', '#8e4ec6', '#ffffff'];
  const B = { tool: 'pen', color: COLORS[0], width: 4, drawing: false, last: null, sid: null, panning: false, space: false, shared: false };

  const sw = $('#swatches');
  COLORS.forEach(c => {
    const b = el('button', { class: 'swatch' + (c === B.color ? ' is-active' : ''), type: 'button', 'aria-label': 'Цвет ' + c, style: { background: c } });
    b.addEventListener('click', () => setColor(c, b));
    sw.appendChild(b);
  });
  const custom = el('label', { class: 'swatch swatch--custom', title: 'Свой цвет' }, el('input', { type: 'color', value: '#ff00aa', 'aria-label': 'Свой цвет' }));
  custom.querySelector('input').addEventListener('input', (e) => setColor(e.target.value, custom));
  sw.appendChild(custom);

  function setColor(c, node) {
    B.color = c;
    $$('.swatch', sw).forEach(x => x.classList.toggle('is-active', x === node));
    if (B.tool !== 'pen') setTool('pen');
    updateWidthDot();
  }
  function updateWidthDot() {
    $('#width-dot').style.setProperty('--w', Math.max(2, B.width * 1.2) + 'px');
    $('#width-dot').style.setProperty('--dot', B.tool === 'eraser' ? 'var(--muted)' : (B.color === '#111111' ? '#f3f3f4' : B.color));
    $('#width-value').textContent = B.width;
  }
  $('#width').addEventListener('input', (e) => { B.width = Number(e.target.value); updateWidthDot(); });
  updateWidthDot();

  function setTool(t) {
    B.tool = t;
    $$('[data-tool]').forEach(b => b.classList.toggle('is-active', b.dataset.tool === t));
    $('#board-stage').classList.toggle('tool-hand', t === 'hand');
    updateWidthDot();
  }
  $$('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

  // Толщина — в единицах холста: при приближении линия выглядит толще, как в FigJam
  function strokeWidth() {
    return B.tool === 'eraser' ? Math.max(16, B.width * 4) : B.width * 1.25;
  }
  function boardPoint(e) {
    const r = bStage.getBoundingClientRect();
    return board.screenToWorld(e.clientX - r.left, e.clientY - r.top);
  }
  function emitStroke(a, b) {
    const s = { sid: B.sid, x0: a.x, y0: a.y, x1: b.x, y1: b.y, color: B.color, width: strokeWidth(), tool: B.tool === 'eraser' ? 'eraser' : 'pen' };
    board.add(s);
    socket.emit('draw', s);
  }

  const bStage = $('#board-stage');
  bStage.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || B.tool === 'hand' || B.space) {
      B.panning = { x: e.clientX, y: e.clientY };
      bStage.classList.add('is-panning');
      bStage.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    B.drawing = true;
    B.sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    B.last = boardPoint(e);
    emitStroke(B.last, { x: B.last.x + 0.01, y: B.last.y + 0.01 });
    bStage.setPointerCapture(e.pointerId);
  });
  bStage.addEventListener('pointermove', (e) => {
    if (B.panning) {
      board.panBy(e.clientX - B.panning.x, e.clientY - B.panning.y);
      B.panning = { x: e.clientX, y: e.clientY };
      syncView();
      return;
    }
    if (!B.drawing) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const p = boardPoint(ev);
      const dx = (p.x - B.last.x) * board.cam.zoom, dy = (p.y - B.last.y) * board.cam.zoom;
      if (dx * dx + dy * dy < 4) continue;
      emitStroke(B.last, p);
      B.last = p;
    }
  });
  const endPointer = () => {
    B.drawing = false;
    if (B.panning) { B.panning = false; bStage.classList.remove('is-panning'); }
  };
  bStage.addEventListener('pointerup', endPointer);
  bStage.addEventListener('pointercancel', endPointer);
  // Колесо — двигать холст, Ctrl+колесо или щипок на тачпаде — масштаб к курсору
  bStage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = bStage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) board.zoomAt(e.clientX - r.left, e.clientY - r.top, board.cam.zoom * Math.exp(-e.deltaY * 0.0045));
    else board.panBy(-e.deltaX, -e.deltaY);
    syncView();
  }, { passive: false });

  // Ученики видят ровно ту область холста, которую видит учитель
  let viewQueued = false;
  function syncView() {
    $('#zoom-reset').textContent = Math.round(board.cam.zoom * 100) + '%';
    if (viewQueued) return;
    viewQueued = true;
    requestAnimationFrame(() => { viewQueued = false; socket.emit('whiteboard-transform', board.visibleRect()); });
  }
  board.onResize = syncView;
  const zoomCenter = (k) => { board.zoomAt(board.cssW / 2, board.cssH / 2, board.cam.zoom * k); syncView(); };
  $('#zoom-in').addEventListener('click', () => zoomCenter(1.25));
  $('#zoom-out').addEventListener('click', () => zoomCenter(1 / 1.25));
  $('#zoom-reset').addEventListener('click', () => { board.zoomAt(board.cssW / 2, board.cssH / 2, 1); syncView(); });
  $('#zoom-fit').addEventListener('click', () => { board.fitContent(); syncView(); });

  function undo() { socket.emit('board-undo'); }
  $('#board-undo').addEventListener('click', undo);
  $('#board-clear').addEventListener('click', async () => {
    if (!board.strokes.length) return;
    if (await CC.confirm('Очистить доску?', 'Рисунок пропадёт у всех учеников. Сохранить его можно кнопкой «Сохранить».', 'Очистить', 'danger')) {
      board.clear();
      socket.emit('clear-canvas');
    }
  });
  $('#board-save').addEventListener('click', async () => {
    const p = await api.saveBoard(board.toPNG());
    if (p) toast('Доска сохранена', { kind: 'positive', action: { label: 'Показать', run: () => api.openPath(p) } });
  });
  // Доска уходит на экраны учеников только по явной кнопке, а не при открытии вкладки
  function setBoardShared(on) {
    B.shared = on;
    socket.emit('whiteboard-mode', on);
    const btn = $('#board-share-btn');
    btn.classList.toggle('is-on', on);
    btn.querySelector('span').textContent = on ? 'Убрать доску с экранов' : 'Показать доску ученикам';
    $('#board-badge').classList.toggle('hidden', !on);
  }
  $('#board-share-btn').addEventListener('click', () => setBoardShared(!B.shared));
  $('#board-badge').addEventListener('click', () => setTab('board'));

  socket.on('board-strokes', (list) => board.setStrokes(list));
  socket.on('clear-canvas', () => board.clear());

  // ---------- Чат ----------
  const chat = new CC.Chat($('#chat'), {
    meId: null,
    canWhisper: true,
    teacherView: true,
    emptyText: 'Сообщения видят все: ученики в классе и дома. Нажмите на имя ученика, чтобы написать ему лично.',
    fileUrl: (u) => BASE + u,
    onSend: (text, to) => socket.emit('chat-message', { text, to }),
    onFile: (file, to) => CC.uploadFile(BASE, socket.id, file, to, { token: S.uploadToken }),
    onUnseen: () => { $('#chat-meta').textContent = chat && chat.unseen ? `${chat.unseen} новых` : ''; updateRightBadge(); }
  });
  socket.on('connect', () => { chat.opts.meId = socket.id; });
  socket.on('chat-message', (m) => chat.add(m));
  socket.on('chat-history', (list) => chat.setHistory(list));
  window.addEventListener('focus', () => { if (chat.nearEnd()) chat.markSeen(); });

  // ---------- Запись урока ----------
  // Записываем «сцену»: открытый экран ученика → доска → эфир → окно приложения.
  // Источник переключается сам, звук — микрофон учителя, эфир и голоса учеников.
  const Recorder = {
    active: false, rec: null, canvas: null, timer: null, appStream: null, startedAt: 0, path: null,
    async start() {
      Mixer.init();
      if (Mixer.ctx.state === 'suspended') Mixer.ctx.resume();
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1920; this.canvas.height = 1080;
      const ctx = this.canvas.getContext('2d');
      try {
        const id = await api.ownWindowSource();
        if (id) {
          this.appStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 } } });
          this.appVideo = el('video', { muted: true, autoplay: true, playsinline: true });
          this.appVideo.srcObject = this.appStream;
          await this.appVideo.play().catch(() => {});
        }
      } catch (e) { this.appStream = null; }
      const draw = () => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 1920, 1080);
        let src = null;
        const vv = $('#viewer-video');
        if (Viewer.mode && vv.videoWidth) src = vv;
        else if (S.tab === 'board') { this.drawBoard(ctx); return; }
        else if (Broadcast.active && $('#preview-video').videoWidth) src = $('#preview-video');
        else if (this.appVideo && this.appVideo.videoWidth) src = this.appVideo;
        if (src) this.fit(ctx, src, src.videoWidth, src.videoHeight);
      };
      this.timer = setInterval(draw, 1000 / 30);
      const tracks = [...this.canvas.captureStream(30).getVideoTracks(), ...Mixer.toRecord.stream.getAudioTracks()];
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
      this.rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 3_000_000 });
      await api.recStart({ teacherName: S.teacherName && S.teacherName !== 'Учитель' ? S.teacherName : '' });
      this.rec.ondataavailable = async (e) => { if (e.data.size) api.recChunk(await e.data.arrayBuffer()); };
      this.rec.onstop = async () => {
        const p = await api.recStop();
        if (p) toast('Запись урока сохранена', { kind: 'positive', action: { label: 'Показать', run: () => api.openPath(p) } });
      };
      this.rec.start(2000);
      this.active = true;
      this.startedAt = Date.now();
      await Mixer.updateMic();
      api.keepAwake(true);
      this.render();
    },
    fit(ctx, src, w, h) {
      const s = Math.min(1920 / w, 1080 / h);
      const dw = w * s, dh = h * s;
      ctx.drawImage(src, (1920 - dw) / 2, (1080 - dh) / 2, dw, dh);
    },
    drawBoard(ctx) {
      // На записи — ровно то, что видит учитель (и ученики)
      this.boardLayer = this.boardLayer || document.createElement('canvas');
      CC.Board.renderTo(ctx, 1920, 1080, board.strokes, board.visibleRect(), { layer: this.boardLayer });
    },
    stop() {
      if (!this.active) return;
      this.active = false;
      clearInterval(this.timer);
      try { this.rec.stop(); } catch (e) {}
      if (this.appStream) this.appStream.getTracks().forEach(t => t.stop());
      this.appStream = null; this.appVideo = null;
      Mixer.updateMic();
      if (!Broadcast.active) api.keepAwake(false);
      this.render();
    },
    render() {
      const b = $('#rec-btn');
      b.classList.toggle('is-recording', this.active);
      b.querySelector('use').setAttribute('href', this.active ? '#i-stop' : '#i-record');
      $('#rec-label').textContent = this.active ? CC.duration(Date.now() - this.startedAt) : 'Запись';
    }
  };
  setInterval(() => { if (Recorder.active) Recorder.render(); }, 1000);
  $('#rec-btn').addEventListener('click', () => {
    if (!window.teacherAPI) { toast('Запись работает в приложении учителя'); return; }
    Recorder.active ? Recorder.stop() : Recorder.start().catch(err => toast('Не удалось начать запись: ' + err.message, { kind: 'warning' }));
  });

  // ---------- Задания: опросы, сбор работ, раздача файлов ----------
  S.activity = { polls: [], collections: [], assignments: [], focus: { enabled: false, words: [] }, students: [] };
  S.openLists = new Set();
  socket.on('activity', applyActivity);

  function applyActivity(a) {
    if (!a) return;
    S.activity = a;
    renderTasks();
    renderFocusBtn();
    const open = a.polls.filter(p => p.open).length + a.collections.filter(c => c.open).length;
    const badge = $('#tab-tasks-count');
    badge.textContent = open;
    badge.classList.toggle('hidden', !open);
  }

  function taskItems() {
    const a = S.activity;
    return [
      ...a.polls.map(p => ({ type: 'poll', open: p.open, ts: p.createdAt, data: p })),
      ...a.collections.map(c => ({ type: 'collect', open: c.open, ts: c.createdAt, data: c })),
      ...a.assignments.map(x => ({ type: 'assign', open: false, ts: x.ts, data: x }))
    ].sort((x, y) => (y.open - x.open) || (y.ts - x.ts));
  }

  function starters(compact) {
    const tile = (iconName, title, text, run, tint) => el('button', { class: 'starter', type: 'button', onclick: run },
      el('span', { class: 'tile tile--' + tint + ' starter__icon' }, icon(iconName)),
      el('span', { class: 'starter__title', text: title }),
      compact ? null : el('span', { class: 'starter__text', text }));
    return el('div', { class: 'starters' },
      tile('poll', 'Быстрый опрос', 'Вопрос с вариантами ответа. Ответы видно сразу, итоги можно показать классу.', createPoll, 'lilac'),
      tile('inbox', 'Собрать работы', 'Ученики сдают файлы одной кнопкой. Работы ложатся в папку, подписанные именами.', createCollection, 'mint'),
      tile('download', 'Раздать файл', 'Файл появится на рабочем столе каждого компьютера класса и в чате урока.', () => $('#assign-file').click(), 'peach'));
  }

  function renderTasks() {
    const root = $('#tasks');
    root.replaceChildren();
    const items = taskItems();
    if (!items.length) {
      root.appendChild(starters(false));
      return;
    }
    for (const it of items) {
      if (it.type === 'poll') root.appendChild(pollCard(it.data));
      if (it.type === 'collect') root.appendChild(collectCard(it.data));
      if (it.type === 'assign') root.appendChild(assignCard(it.data));
    }
  }

  function taskHead(kindIcon, kind, title, open, menuItems) {
    return el('div', { class: 'task__head' },
      el('div', { class: 'task__main' },
        el('div', { class: 'task__kind' }, icon(kindIcon, 'i-sm'), el('span', { text: kind }),
          open ? el('span', { class: 'badge badge--positive', style: { height: '18px', fontSize: '11px' } }, el('span', { class: 'dot dot--positive dot--pulse' }), 'идёт') : null),
        el('div', { class: 'task__title', text: title })),
      menuItems ? el('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Ещё', onclick: (e) => CC.menu(e.currentTarget, menuItems, { alignRight: true }) }, icon('more', 'i-sm')) : null);
  }

  function listToggle(key, label, build) {
    const open = S.openLists.has(key);
    const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    const btn = el('button', { class: 'btn btn--sm btn--ghost task__toggle', type: 'button' },
      icon(open ? 'chevron-down' : 'chevron-right', 'i-sm'), label);
    btn.addEventListener('click', () => { if (S.openLists.has(key)) S.openLists.delete(key); else S.openLists.add(key); renderTasks(); });
    wrap.appendChild(btn);
    if (open) wrap.appendChild(build());
    return wrap;
  }

  function pollCard(p) {
    const eligible = Math.max(S.activity.students.length, p.total);
    const max = Math.max(0, ...p.counts);
    const bars = el('div', { class: 'bars' });
    p.options.forEach((opt, i) => {
      const c = p.counts[i] || 0;
      const pct = p.total ? Math.round(c / p.total * 100) : 0;
      bars.appendChild(el('div', { class: 'bar' + (c && c === max ? ' is-top' : '') },
        el('span', { class: 'bar__label', text: opt }),
        el('span', { class: 'bar__value', text: p.total ? `${c} (${pct}%)` : '0' }),
        el('div', { class: 'bar__track' }, el('div', { class: 'bar__fill', style: { width: pct + '%' } }))));
    });
    const body = el('div', { class: 'task__body' }, bars);
    if (p.voters && p.voters.length) {
      body.appendChild(listToggle('pv:' + p.id, 'Кто как ответил', () => el('ul', { class: 'subs' },
        ...p.voters.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(v => el('li', null,
          CC.avatar(v.name, { sm: true }), el('span', { class: 'subs__name', text: v.name }), el('span', { class: 'subs__file', text: p.options[v.option] }))))));
    }
    return el('article', { class: 'task' + (p.open ? ' is-open' : '') },
      taskHead('poll', 'Опрос', p.question, p.open, [
        { icon: 'chat', label: 'Отправить итоги в чат', run: () => sendPollToChat(p) },
        { icon: 'trash', label: 'Удалить опрос', danger: true, run: () => socket.emit('poll-delete', { id: p.id }) }
      ]),
      body,
      el('div', { class: 'task__foot' },
        el('span', { class: 'task__meta', text: `Ответили ${p.total} из ${eligible}` }),
        p.open ? el('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: () => socket.emit('poll-close', { id: p.id }) }, icon('check', 'i-sm'), 'Завершить и показать итоги')
          : el('span', { class: 'faint', style: { fontSize: 'var(--fs-sm)' }, text: 'Итоги показаны ученикам' })));
  }

  function sendPollToChat(p) {
    const lines = p.options.map((o, i) => `${o}: ${p.counts[i] || 0}`);
    socket.emit('chat-message', { text: `Итоги опроса «${p.question}»\n${lines.join('\n')}` });
    toast('Итоги отправлены в чат', { kind: 'positive', icon: 'chat' });
  }

  function collectCard(c) {
    const names = new Set(c.submissions.map(x => x.name));
    const missing = S.activity.students.filter(st => !names.has(st.name));
    const eligible = Math.max(S.activity.students.length, c.submissions.length) || 0;
    const pct = eligible ? Math.round(c.submissions.length / eligible * 100) : 0;
    const body = el('div', { class: 'task__body' },
      el('div', { class: 'progress', title: `${pct}%` }, el('div', { class: 'progress__fill', style: { width: pct + '%' } })));
    if (c.submissions.length) {
      body.appendChild(el('ul', { class: 'subs' }, ...c.submissions.slice().sort((a, b) => b.ts - a.ts).map(x => el('li', null,
        CC.avatar(x.name, { sm: true }), el('span', { class: 'subs__name', text: x.name }),
        el('span', { class: 'subs__file', text: x.filename, title: x.filename }), el('span', { class: 'subs__time', text: CC.clock(x.ts) })))));
    } else {
      body.appendChild(el('div', { class: 'faint', style: { fontSize: 'var(--fs-sm)' }, text: c.open ? 'Ждём первые работы. У учеников появилась кнопка «Сдать работу».' : 'Никто не сдал работу.' }));
    }
    if (c.open && missing.length) {
      body.appendChild(listToggle('cm:' + c.id, `Ещё не сдали: ${missing.length}`, () => el('ul', { class: 'subs subs--missing' },
        ...missing.map(st => el('li', null, CC.avatar(st.name, { sm: true }), el('span', { class: 'subs__name', text: st.name }),
          el('span', { class: 'subs__file', text: st.role === 'agent' ? 'в классе' : 'онлайн' }))))));
    }
    return el('article', { class: 'task' + (c.open ? ' is-open' : '') },
      taskHead('inbox', 'Сбор работ', c.title, c.open, null),
      body,
      el('div', { class: 'task__foot' },
        el('span', { class: 'task__meta', text: `Сдали ${c.submissions.length} из ${eligible}` }),
        el('button', { class: 'btn btn--sm', type: 'button', onclick: () => api.openFolder(c.dir) }, icon('folder', 'i-sm'), 'Папка'),
        c.open ? el('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: () => socket.emit('collect-stop', { id: c.id }) }, 'Закончить сбор') : null));
  }

  function assignCard(x) {
    return el('article', { class: 'task' },
      taskHead('download', 'Раздан файл', x.filename, false, null),
      el('div', { class: 'task__foot' },
        el('span', { class: 'task__meta', text: `${CC.size(x.size)}, в ${CC.clock(x.ts)}` }),
        el('a', { class: 'btn btn--sm', href: BASE + x.url, download: x.filename }, icon('download', 'i-sm'), 'Скачать')));
  }

  async function createPoll() {
    const q = el('input', { class: 'input input--lg', placeholder: 'Например: Сколько будет 7 × 8?', maxlength: 300 });
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    const addOpt = (val) => {
      if (list.children.length >= 8) return;
      const input = el('input', { class: 'input', placeholder: `Вариант ${list.children.length + 1}`, maxlength: 120 });
      input.value = val || '';
      const row = el('div', { class: 'poll-opt' }, input,
        el('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Убрать вариант', onclick: () => { if (list.children.length > 2) row.remove(); } }, icon('x', 'i-sm')));
      list.appendChild(row);
      return input;
    };
    const setOpts = (arr) => { list.replaceChildren(); arr.forEach(addOpt); };
    setOpts(['', '']);
    const presets = [['Да', 'Нет'], ['Понятно', 'Частично', 'Не понятно'], ['А', 'Б', 'В', 'Г']];
    const body = el('div', { class: 'poll-form' },
      el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Вопрос' }), q),
      el('div', { class: 'field' }, el('span', { class: 'field__label', text: 'Варианты' }), list,
        el('div', { class: 'chips', style: { marginTop: '4px' } },
          el('button', { class: 'chip', type: 'button', onclick: () => addOpt('')?.focus() }, icon('plus', 'i-sm'), 'Вариант'),
          ...presets.map(pr => el('button', { class: 'chip', type: 'button', text: pr.join(' / '), onclick: () => setOpts(pr) })))));
    const ok = await CC.dialog({
      title: 'Быстрый опрос', sub: 'Вопрос появится у всех учеников: в классе и дома.', body, wide: true,
      actions: [{ label: 'Отмена', value: null }, { label: 'Начать опрос', kind: 'primary', primary: true, value: () => true }]
    });
    if (!ok) return;
    const question = q.value.trim();
    const options = [...list.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    if (!question || options.length < 2) { toast('Нужен вопрос и хотя бы два варианта', { kind: 'warning' }); return; }
    socket.emit('poll-start', { question, options });
    setTab('tasks');
  }

  async function createCollection() {
    const title = await CC.prompt({ title: 'Собрать работы', sub: 'У учеников появится кнопка «Сдать работу». Повторная сдача заменяет прежний файл.', label: 'Что собираем', value: 'Работа на уроке', okLabel: 'Начать сбор' });
    if (!title) return;
    socket.emit('collect-start', { title });
    setTab('tasks');
  }

  $('#task-poll').addEventListener('click', createPoll);
  $('#task-collect').addEventListener('click', createCollection);
  $('#task-assign').addEventListener('click', () => $('#assign-file').click());
  $('#assign-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    await CC.uploadFile(BASE, socket.id, f, null, { assign: '1', token: S.uploadToken });
    toast(`«${f.name}» отправлен на компьютеры класса`, { kind: 'positive', icon: 'download' });
  });

  // ---------- Режим «Фокус» ----------
  const FOCUS_PRESETS = ['YouTube', 'ВКонтакте', 'TikTok', 'Telegram', 'Discord', 'Steam', 'Roblox', 'Minecraft', 'Twitch', 'Одноклассники'];
  function renderFocusBtn() {
    const f = S.activity.focus || {};
    const b = $('#focus-btn');
    b.classList.toggle('is-on', Boolean(f.enabled));
    b.title = f.enabled ? 'Фокус включён: ' + f.words.join(', ') : 'Предупреждать, если ученик открыл запрещённое';
  }
  $('#focus-btn').addEventListener('click', async () => {
    const f = S.activity.focus || { enabled: false, words: [] };
    const chosen = new Set(f.words.length ? f.words : ['youtube', 'вконтакте', 'tiktok', 'steam', 'roblox']);
    const enabled = el('input', { type: 'checkbox' });
    enabled.checked = f.enabled || !f.words.length;
    const chips = el('div', { class: 'chips' });
    const renderChips = () => {
      chips.replaceChildren();
      const all = [...new Set([...FOCUS_PRESETS.map(w => w.toLowerCase()), ...chosen])];
      all.forEach(w => {
        const label = FOCUS_PRESETS.find(p => p.toLowerCase() === w) || w;
        chips.appendChild(el('button', { class: 'chip' + (chosen.has(w) ? ' is-on' : ''), type: 'button', text: label, onclick: () => { if (chosen.has(w)) chosen.delete(w); else chosen.add(w); renderChips(); } }));
      });
    };
    renderChips();
    const custom = el('input', { class: 'input', placeholder: 'Своё слово из заголовка окна и Enter' });
    custom.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && custom.value.trim()) { e.preventDefault(); e.stopPropagation(); chosen.add(custom.value.trim().toLowerCase()); custom.value = ''; renderChips(); }
    });
    const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
      el('label', { class: 'switch' }, el('span', { class: 'switch__text' }, el('span', { class: 'switch__label', text: 'Следить за окнами учеников' }), el('span', { class: 'switch__hint', text: 'Если в заголовке окна есть слово из списка, карточка ПК подсветится и придёт уведомление' })), enabled, el('span', { class: 'switch__track' })),
      el('div', { class: 'field' }, el('span', { class: 'field__label', text: 'Что считать отвлечением' }), chips),
      custom);
    const ok = await CC.dialog({ title: 'Фокус на уроке', body, wide: true, actions: [{ label: 'Отмена', value: null }, { label: 'Сохранить', kind: 'primary', value: () => true }] });
    if (!ok) return;
    socket.emit('focus-set', { enabled: enabled.checked, words: [...chosen] });
    toast(enabled.checked && chosen.size ? 'Фокус включён' : 'Фокус выключен', { kind: 'positive', icon: 'target' });
  });
  const focusToastAt = new Map();
  socket.on('focus-alert', ({ agentId, name, title }) => {
    const last = focusToastAt.get(agentId) || 0;
    if (Date.now() - last < 60000) return;
    focusToastAt.set(agentId, Date.now());
    toast(`${name}: ${title}`, { kind: 'warning', icon: 'target', duration: 8000, action: { label: 'Открыть', run: () => openViewer(agentId) } });
  });

  // ---------- Тема ----------
  // auto — как в системе; светлая или тёмная — явный выбор. Смена — с плавным переходом.
  function applyTheme(theme) {
    if (window.CCTheme) { if (CCTheme.get() !== theme) CCTheme.set(theme); }
    else document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }
  applyTheme(settings.theme || 'auto');
  function themeItem() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const next = dark ? 'light' : 'dark';
    return { icon: dark ? 'sun' : 'moon', label: dark ? 'Светлая тема' : 'Тёмная тема', run: () => { applyTheme(next); api.saveSettings({ theme: next }).then(x => { if (x) settings = x; }); } };
  }

  // ---------- Кабинет, первый запуск, прошлый урок ----------
  async function bindRoom() {
    if (!settings.roomName) { toast('Сначала укажите кабинет в настройках', { kind: 'warning' }); openSettings(); return; }
    const n = S.agents.size;
    if (!n) { toast('Нет подключённых компьютеров'); return; }
    const ok = await CC.confirm(`Закрепить ${n} ${CC.plural(n, 'компьютер', 'компьютера', 'компьютеров')} за «${settings.roomName}»?`,
      'Эти ПК будут подключаться только к учителю этого кабинета, даже если в сети есть другие учителя. Уже закреплённые за другим кабинетом не изменятся.', 'Закрепить');
    if (ok) { socket.emit('bind-room'); toast('Компьютеры закреплены за кабинетом', { kind: 'positive', icon: 'lock' }); }
  }

  // Один раз для кабинета — название (по нему ПК находят своего учителя)
  async function setupRoom() {
    const room = el('input', { class: 'input input--lg', value: settings.roomName || '', placeholder: 'Например: Кабинет 301', maxlength: 60 });
    const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
      el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Кабинет' }), room),
      el('p', { class: 'onboard__why', text: 'Настраивается один раз для этого компьютера. Компьютеры класса подключатся только к учителю своего кабинета, даже если в школе работают несколько учителей.' }));
    while (!room.value.trim()) {
      await CC.dialog({ hero: { point: 'down', motion: 'nudge' }, title: 'Как называется этот кабинет?', body, actions: [{ label: 'Готово', kind: 'primary', primary: true, value: () => true }] });
      if (!room.value.trim()) toast('Укажите кабинет', { kind: 'warning' });
    }
    settings = await api.saveSettings({ roomName: room.value.trim(), onboarded: true }) || settings;
    $('#room-name').textContent = settings.roomName;
  }

  setTimeout(async () => {
    if (!settings.roomName) await setupRoom();
    if (boot.previous) await askPrevious(boot.previous);
    else await startLesson();
  }, 300);

  // ---------- Мониторинг: скриншоты нужны, только когда их видно ----------
  function syncMonitoring() {
    socket.emit('monitoring-active', S.tab === 'monitoring' && !document.hidden);
  }
  document.addEventListener('visibilitychange', syncMonitoring);

  // ---------- Настройки эфира свёрнуты: меняются редко ----------
  function renderStudioSummary() {
    const q = $('#quality');
    $('#studio-summary').textContent = `${q.options[q.selectedIndex].text}, ${$('#fps').value} к/с`;
  }
  $('#studio-more').addEventListener('click', () => {
    const open = !$('#studio').classList.contains('is-open');
    $('#studio').classList.toggle('is-open', open);
    $('#studio-more').setAttribute('aria-expanded', String(open));
  });
  $('#quality').addEventListener('change', renderStudioSummary);
  $('#fps').addEventListener('change', renderStudioSummary);
  renderStudioSummary();

  // ---------- Кто сидит за ПК (учитель пересаживает) ----------
  async function assignSeat(agentId) {
    const a = S.agents.get(agentId);
    if (!a) return;
    const names = [...new Set([...[...S.agents.values()].map(x => x.student).filter(Boolean), ...[...S.online.values()].map(u => u.name)])];
    const input = el('input', { class: 'input input--lg', list: 'seat-names', placeholder: 'Имя ученика', value: a.student || '' });
    const list = el('datalist', { id: 'seat-names' }, ...names.map(n => el('option', { value: n })));
    const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Кто сейчас за ' + a.name }), input, list),
      el('p', { class: 'onboard__why', text: 'Если этот ученик числится за другим ПК, то другое место освободится: ответы и работы ученика перейдут вместе с ним.' }));
    const ok = await CC.dialog({ title: a.student ? 'Пересадить' : 'Кто сидит за ПК', body,
      actions: [{ label: 'Отмена', value: null }, { label: 'Сохранить', kind: 'primary', primary: true, value: () => true }] });
    if (!ok) return;
    socket.emit('seat-assign', { agentId, name: input.value.trim() || null });
  }

  // ---------- Клавиатура ----------
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (!$('#viewer').classList.contains('hidden')) {
      if (e.key === 'Escape' && !Viewer.control && !document.querySelector('.overlay')) closeViewer(false);
      return;
    }
    if (document.querySelector('.overlay')) return;
    if ((e.ctrlKey || e.metaKey) && e.key === '1') { e.preventDefault(); setTab('monitoring'); }
    if ((e.ctrlKey || e.metaKey) && e.key === '2') { e.preventDefault(); setTab('board'); }
    if ((e.ctrlKey || e.metaKey) && e.key === '3') { e.preventDefault(); setTab('tasks'); }
    if (typing) return;
    if (S.tab === 'board') {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); }
      if (e.code === 'KeyP') setTool('pen');
      if (e.code === 'KeyE') setTool('eraser');
      if (e.code === 'KeyH') setTool('hand');
      if (e.code === 'Space' && !B.space) { B.space = true; bStage.classList.add('tool-hand'); e.preventDefault(); }
    }
    if (S.tab === 'monitoring' && (e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
      e.preventDefault(); $('#search').classList.add('is-open'); $('#pc-search').focus();
    }
    if (S.tab === 'monitoring' && (e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
      e.preventDefault();
      visibleAgents().forEach(a => toggleSelect(a.id, true));
    }
    if (e.key === 'Escape' && S.selected.size) [...S.selected].forEach(id => toggleSelect(id, false));
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && B.space) { B.space = false; bStage.classList.toggle('tool-hand', B.tool === 'hand'); }
  });

  // Первичная отрисовка
  renderGrid();
  renderPeople();
  updateCounts();
  Broadcast.render();
  renderLinks();
})();
