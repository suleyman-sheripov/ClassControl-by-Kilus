/* ClassControl — общие помощники интерфейса: уведомления, диалоги, меню, чат, доска, WebRTC.
   Один файл для приложения учителя, окон ученика и страницы онлайн-участника. */
(function (global) {
  'use strict';

  const CC = {};

  // ---------- DOM ----------
  CC.$ = (sel, root) => (root || document).querySelector(sel);
  CC.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  CC.el = function (tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;            // только для доверенной разметки (иконки)
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  };

  CC.icon = function (name, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'i ' + (cls || ''));
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  };

  // ---------- Форматирование ----------
  CC.pad2 = n => String(n).padStart(2, '0');
  CC.clock = ts => { const d = new Date(ts); return CC.pad2(d.getHours()) + ':' + CC.pad2(d.getMinutes()); };
  CC.duration = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${CC.pad2(m)}:${CC.pad2(sec)}` : `${CC.pad2(m)}:${CC.pad2(sec)}`;
  };
  CC.size = (bytes) => {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' КБ';
    return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
  };
  CC.plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  CC.idleText = (sec) => {
    if (sec < 60) return 'активен';
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m} мин без действий`;
    return `${Math.floor(m / 60)} ч без действий`;
  };

  CC.initials = (name) => {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };

  /** Постоянный оттенок для человека: бледный фон + светлая подпись. */
  CC.tint = (name) => {
    let h = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = (h % 12) * 30 + 8;
    return { bg: `hsl(${hue} 32% 20%)`, ink: `hsl(${hue} 70% 80%)`, solid: `hsl(${hue} 65% 64%)` };
  };

  CC.avatar = (name, opts = {}) => {
    const a = CC.el('span', { class: 'avatar' + (opts.sm ? ' avatar--sm' : '') + (opts.teacher ? ' avatar--teacher' : ''), text: CC.initials(name), 'aria-hidden': 'true' });
    if (!opts.teacher) {
      const t = CC.tint(name);
      a.style.setProperty('--av-bg', t.bg);
      a.style.setProperty('--av-ink', t.ink);
    }
    return a;
  };

  // ---------- Уведомления ----------
  CC.toast = function (text, opts = {}) {
    let host = document.getElementById('toasts');
    if (!host) {
      host = CC.el('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(host);
    }
    const kind = opts.kind || 'info';
    const iconName = opts.icon || { positive: 'check', warning: 'alert', live: 'live', accent: 'raise', info: 'info' }[kind] || 'info';
    const node = CC.el('div', { class: `toast toast--${kind}` }, CC.icon(iconName), CC.el('span', { text }));
    if (opts.action) {
      node.appendChild(CC.el('button', {
        class: 'btn btn--sm toast__action', text: opts.action.label,
        onclick: () => { opts.action.run(); close(); }
      }));
    }
    host.appendChild(node);
    function close() {
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 200);
    }
    setTimeout(close, opts.duration || 4500);
    return close;
  };

  // ---------- Диалоги ----------
  CC.dialog = function ({ title, sub, body, actions, wide, onOpen }) {
    return new Promise((resolve) => {
      const overlay = CC.el('div', { class: 'overlay' });
      const close = (value) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(value);
      };
      const foot = CC.el('div', { class: 'dialog__foot' });
      (actions || [{ label: 'Закрыть', value: null }]).forEach((a) => {
        foot.appendChild(CC.el('button', {
          class: 'btn ' + (a.kind ? 'btn--' + a.kind : ''), type: 'button', text: a.label,
          onclick: () => close(typeof a.value === 'function' ? a.value() : a.value)
        }));
      });
      const dialog = CC.el('div', { class: 'dialog' + (wide ? ' dialog--wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        CC.el('div', { class: 'dialog__head' },
          CC.el('div', null,
            CC.el('h2', { class: 'dialog__title', text: title }),
            sub ? CC.el('p', { class: 'dialog__sub', text: sub }) : null),
          CC.el('button', { class: 'icon-btn dialog__close', type: 'button', 'aria-label': 'Закрыть', onclick: () => close(null) }, CC.icon('x'))),
        body ? CC.el('div', { class: 'dialog__body' }, body) : null,
        foot);
      overlay.appendChild(dialog);
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
          const primary = actions && actions.find(a => a.primary);
          if (primary) { e.preventDefault(); close(typeof primary.value === 'function' ? primary.value() : primary.value); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      const first = dialog.querySelector('input, textarea, select');
      (first || dialog.querySelector('.dialog__foot .btn:last-child')).focus();
      if (onOpen) onOpen(dialog, close);
    });
  };

  CC.confirm = (title, sub, okLabel, kind) => CC.dialog({
    title, sub,
    actions: [{ label: 'Отмена', value: false }, { label: okLabel || 'Да', value: true, kind: kind || 'primary', primary: true }]
  });

  CC.prompt = ({ title, sub, label, placeholder, value, multiline, okLabel, validate }) => {
    const input = multiline
      ? CC.el('textarea', { class: 'textarea', placeholder: placeholder || '', rows: 4 })
      : CC.el('input', { class: 'input input--lg', placeholder: placeholder || '' });
    input.value = value || '';
    const field = CC.el('label', { class: 'field' }, label ? CC.el('span', { class: 'field__label', text: label }) : null, input);
    return CC.dialog({
      title, sub, body: field,
      actions: [
        { label: 'Отмена', value: null },
        { label: okLabel || 'Готово', kind: 'primary', primary: true, value: () => {
          const v = input.value.trim();
          if (validate && !validate(v)) return null;
          return v || null;
        } }
      ]
    });
  };

  // ---------- Контекстное меню ----------
  CC.menu = function (anchor, items, opts = {}) {
    CC.closeMenus();
    const menu = CC.el('div', { class: 'menu', role: 'menu' });
    items.forEach((it) => {
      if (it === '-') { menu.appendChild(CC.el('div', { class: 'menu__sep' })); return; }
      if (!it) return;
      menu.appendChild(CC.el('button', {
        class: 'menu__item' + (it.danger ? ' menu__item--danger' : ''), role: 'menuitem', type: 'button',
        onclick: () => { CC.closeMenus(); it.run(); }
      }, it.icon ? CC.icon(it.icon) : null, CC.el('span', { text: it.label })));
    });
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let x = opts.alignRight ? r.right - mw : r.left;
    let y = r.bottom + 4;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 4);
    x = Math.min(Math.max(8, x), window.innerWidth - mw - 8);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    setTimeout(() => {
      document.addEventListener('mousedown', CC._menuOutside = (e) => { if (!menu.contains(e.target)) CC.closeMenus(); });
      document.addEventListener('keydown', CC._menuKey = (e) => { if (e.key === 'Escape') CC.closeMenus(); });
    });
    menu.querySelector('.menu__item')?.focus();
    return menu;
  };
  CC.closeMenus = function () {
    CC.$$('.menu').forEach(m => m.remove());
    if (CC._menuOutside) document.removeEventListener('mousedown', CC._menuOutside);
    if (CC._menuKey) document.removeEventListener('keydown', CC._menuKey);
  };

  CC.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = CC.el('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    }
  };

  // ---------- Чат ----------
  /**
   * new CC.Chat(root, { meId, onSend(text, to), onFile(file, to), fileUrl(url), canWhisper })
   * root должен содержать .chat__list и .composer (см. разметку в приложениях).
   */
  class Chat {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts;
      this.list = root.querySelector('.chat__list');
      this.input = root.querySelector('.composer__input');
      this.sendBtn = root.querySelector('.composer__send');
      this.attachBtn = root.querySelector('.composer__attach');
      this.fileInput = root.querySelector('.composer__file');
      this.toRow = root.querySelector('.composer__to');
      this.newBtn = CC.el('button', { class: 'chat__new hidden', type: 'button', text: 'Новые сообщения', onclick: () => this.scrollToEnd(true) });
      root.appendChild(this.newBtn);
      this.last = null;
      this.to = null;
      this.unseen = 0;
      this.onUnseen = opts.onUnseen || (() => {});

      this.input.addEventListener('input', () => this.autosize());
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
        if (e.key === 'Escape' && this.to) this.setRecipient(null);
      });
      this.sendBtn.addEventListener('click', () => this.send());
      if (this.attachBtn && this.fileInput) {
        this.attachBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', () => {
          const f = this.fileInput.files[0];
          if (f) this.opts.onFile(f, this.to && this.to.id);
          this.fileInput.value = '';
        });
      }
      this.list.addEventListener('scroll', () => {
        if (this.nearEnd()) { this.newBtn.classList.add('hidden'); this.markSeen(); }
      });
      this.autosize();
    }
    autosize() {
      this.input.style.height = 'auto';
      // Скрытое окно даёт высоту 0 — тогда оставляем естественную высоту в одну строку
      if (this.input.scrollHeight) this.input.style.height = Math.min(120, this.input.scrollHeight) + 'px';
      this.sendBtn.disabled = !this.input.value.trim();
    }
    send() {
      const text = this.input.value.trim();
      if (!text) return;
      this.opts.onSend(text, this.to && this.to.id);
      this.input.value = '';
      this.autosize();
    }
    setRecipient(to) {
      this.to = to;
      if (!this.toRow) return;
      this.toRow.replaceChildren();
      if (to) {
        this.toRow.append(CC.icon('lock', 'i-sm'), CC.el('span', { text: 'Лично: ' + to.name }),
          CC.el('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Писать всем', onclick: () => this.setRecipient(null) }, CC.icon('x', 'i-sm')));
        this.toRow.classList.remove('hidden');
        this.input.placeholder = 'Личное сообщение…';
        this.input.focus();
      } else {
        this.toRow.classList.add('hidden');
        this.input.placeholder = this.opts.placeholder || 'Сообщение для всех…';
      }
    }
    nearEnd() { return this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 60; }
    scrollToEnd(force) {
      if (force || this.nearEnd()) {
        this.list.scrollTop = this.list.scrollHeight;
        this.newBtn.classList.add('hidden');
        this.markSeen();
      }
    }
    markSeen() { if (this.unseen) { this.unseen = 0; this.onUnseen(0); } }
    clear() { this.list.replaceChildren(); this.last = null; }
    setHistory(msgs) {
      this.clear();
      if (!msgs.length) this.list.appendChild(this.emptyNode());
      msgs.forEach(m => this.add(m, true));
      this.scrollToEnd(true);
    }
    emptyNode() {
      return CC.el('div', { class: 'empty chat__empty', style: { flex: '1' } },
        CC.icon('chat', 'i-xl empty__icon'),
        CC.el('div', { class: 'empty__title', text: 'Сообщений пока нет' }),
        CC.el('div', { class: 'empty__text', text: this.opts.emptyText || 'Напишите классу — сообщение увидят все участники урока.' }));
    }
    add(m, silent) {
      this.list.querySelector('.chat__empty')?.remove();
      const stick = this.nearEnd();
      const node = m.type === 'system' ? CC.el('div', { class: 'msg msg--system', text: m.text }) : this.renderMessage(m);
      this.list.appendChild(node);
      if (silent) return;
      const mine = m.senderId === this.opts.meId;
      if (stick || mine) this.scrollToEnd(true);
      else this.newBtn.classList.remove('hidden');
      const hidden = !document.hasFocus() || this.root.offsetParent === null;
      if (!mine && (hidden || !stick)) { this.unseen++; this.onUnseen(this.unseen); }
    }
    renderMessage(m) {
      const isTeacher = m.role === 'teacher';
      const cont = this.last && this.last.senderId === m.senderId && m.ts - this.last.ts < 3 * 60000 &&
        (this.last.to || null) === (m.to || null) && this.last.type !== 'system';
      this.last = m;
      const nameNode = CC.el('span', { class: 'msg__name', text: m.sender });
      if (!isTeacher) nameNode.style.color = CC.tint(m.sender).ink;
      if (this.opts.canWhisper && m.senderId !== this.opts.meId && !isTeacher) {
        nameNode.style.cursor = 'pointer';
        nameNode.title = 'Написать лично';
        nameNode.addEventListener('click', () => this.setRecipient({ id: m.senderId, name: m.sender }));
      }
      const body = CC.el('div', { class: 'msg__body' });
      if (m.to) {
        const label = m.senderId === this.opts.meId ? 'лично для ' + (m.toName || 'учителя') : 'лично вам';
        body.appendChild(CC.el('div', { class: 'msg__private' }, CC.icon('lock', 'i-sm'), CC.el('span', { text: this.opts.teacherView && m.senderId !== this.opts.meId ? 'лично учителю' : label })));
      }
      if (m.type === 'file') body.appendChild(this.renderFile(m));
      else body.appendChild(document.createTextNode(m.text));
      return CC.el('div', { class: 'msg' + (cont ? ' msg--cont' : '') + (m.to ? ' msg--private' : '') },
        CC.avatar(m.sender, { teacher: isTeacher }),
        CC.el('div', { class: 'msg__head' },
          nameNode,
          isTeacher ? CC.el('span', { class: 'msg__role', text: 'учитель' }) : null,
          CC.el('span', { class: 'msg__time', text: CC.clock(m.ts) })),
        body);
    }
    renderFile(m) {
      const url = this.opts.fileUrl ? this.opts.fileUrl(m.url) : m.url;
      const wrap = CC.el('div');
      if (m.isImage) {
        const img = CC.el('img', { class: 'file-thumb', src: url + '?view=1', alt: m.filename, loading: 'lazy' });
        img.addEventListener('click', () => this.opts.openFile ? this.opts.openFile(url, m) : window.open(url + '?view=1'));
        wrap.appendChild(img);
      }
      wrap.appendChild(CC.el('a', { class: 'file-card', href: url, download: m.filename, target: '_blank', rel: 'noopener' },
        CC.el('span', { class: 'file-card__icon' }, CC.icon(m.isImage ? 'image' : 'file')),
        CC.el('span', { style: { minWidth: '0', flex: '1' } },
          CC.el('div', { class: 'file-card__name', text: m.filename }),
          CC.el('div', { class: 'file-card__meta', text: CC.size(m.size || 0) })),
        CC.icon('download', 'i-sm')));
      return wrap;
    }
  }
  CC.Chat = Chat;

  CC.uploadFile = async function (base, socketId, file, to) {
    if (file.size > 50 * 1024 * 1024) { CC.toast('Файл больше 50 МБ', { kind: 'warning' }); return; }
    const fd = new FormData();
    fd.append('socketId', socketId);
    if (to) fd.append('to', to);
    fd.append('file', file);
    const stop = CC.toast('Отправляю «' + file.name + '»…', { icon: 'clip', duration: 60000 });
    try {
      const res = await fetch(base + '/upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      stop();
      if (!res.ok) CC.toast(data.error || 'Не удалось отправить файл', { kind: 'warning' });
    } catch (e) {
      stop();
      CC.toast('Нет связи с сервером урока', { kind: 'warning' });
    }
  };

  // ---------- Доска ----------
  /** Рисует штрихи (координаты 0..1) на холсте 16:9, вписанном в контейнер. */
  class Board {
    constructor(container, canvas, opts = {}) {
      this.container = container;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.strokes = [];
      this.transform = { zoom: 1, panX: 0, panY: 0 };
      this.maxRes = opts.maxRes || 3840;
      this.ro = new ResizeObserver(() => this.fit());
      this.ro.observe(container);
      this.fit();
    }
    fit() {
      const rect = this.container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pad = this.padding || 0;
      const availW = rect.width - pad * 2, availH = rect.height - pad * 2;
      let w = availW, h = w * 9 / 16;
      if (h > availH) { h = availH; w = h * 16 / 9; }
      w = Math.floor(w); h = Math.floor(h);
      this.cssW = w; this.cssH = h;
      Object.assign(this.canvas.style, {
        width: w + 'px', height: h + 'px',
        left: Math.floor((rect.width - w) / 2) + 'px',
        top: Math.floor((rect.height - h) / 2) + 'px'
      });
      const scale = Math.min(this.maxRes / w, (window.devicePixelRatio || 1) * 1.5);
      const pw = Math.round(w * scale), ph = Math.round(h * scale);
      if (this.canvas.width !== pw || this.canvas.height !== ph) {
        this.canvas.width = pw; this.canvas.height = ph;
        this.redraw();
      }
      this.applyTransform();
    }
    setStrokes(list) { this.strokes = list.slice(); this.redraw(); }
    add(s) { this.strokes.push(s); this.draw(s); }
    clear() { this.strokes = []; this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    redraw() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      for (const s of this.strokes) this.draw(s);
    }
    draw(s) {
      const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
      c.save();
      c.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
      c.strokeStyle = s.color || '#111';
      c.lineWidth = Math.max(1, s.width * W);
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(s.x0 * W, s.y0 * H);
      c.lineTo(s.x1 * W, s.y1 * H);
      c.stroke();
      c.restore();
    }
    setTransform(t) { this.transform = { zoom: t.zoom || 1, panX: t.panX || 0, panY: t.panY || 0 }; this.applyTransform(); }
    applyTransform() {
      const t = this.transform;
      this.canvas.style.transform = `translate(${t.panX * (this.cssW || 0)}px, ${t.panY * (this.cssH || 0)}px) scale(${t.zoom})`;
    }
    toPNG() {
      const out = document.createElement('canvas');
      out.width = this.canvas.width; out.height = this.canvas.height;
      const c = out.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height);
      c.drawImage(this.canvas, 0, 0);
      return out.toDataURL('image/png');
    }
  }
  CC.Board = Board;

  // ---------- WebRTC ----------
  CC.ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

  /** Соединение, которое принимает поток (зритель эфира или учитель, принимающий экран). */
  CC.answerPeer = function ({ socket, source, kind, onTrack, onState, sendTracks }) {
    const pc = new RTCPeerConnection(CC.ICE);
    const pending = [];
    pc.ontrack = (e) => onTrack && onTrack(e.streams[0] || new MediaStream([e.track]), e.track);
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('signal', { target: source, kind, type: 'ice', payload: e.candidate }); };
    pc.onconnectionstatechange = () => onState && onState(pc.connectionState);
    if (sendTracks) sendTracks.getTracks().forEach(t => pc.addTrack(t, sendTracks));
    return {
      pc,
      async offer(sdp) {
        await pc.setRemoteDescription(sdp);
        while (pending.length) await pc.addIceCandidate(pending.shift()).catch(() => {});
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { target: source, kind, type: 'answer', payload: pc.localDescription });
      },
      async ice(c) {
        if (!pc.remoteDescription) pending.push(c);
        else await pc.addIceCandidate(c).catch(() => {});
      },
      close() { try { pc.close(); } catch (e) {} }
    };
  };

  /** Соединение, которое отправляет поток и само делает предложение. */
  CC.offerPeer = async function ({ socket, target, kind, stream, onState, onTrack, receiveAudio, tune }) {
    const pc = new RTCPeerConnection(CC.ICE);
    const pending = [];
    if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));
    if (receiveAudio) pc.addTransceiver('audio', { direction: stream && stream.getAudioTracks().length ? 'sendrecv' : 'recvonly' });
    pc.ontrack = (e) => onTrack && onTrack(e.streams[0] || new MediaStream([e.track]), e.track);
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('signal', { target, kind, type: 'ice', payload: e.candidate }); };
    pc.onconnectionstatechange = () => onState && onState(pc.connectionState);
    if (tune) tune(pc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { target, kind, type: 'offer', payload: pc.localDescription });
    return {
      pc,
      async answer(sdp) {
        await pc.setRemoteDescription(sdp);
        while (pending.length) await pc.addIceCandidate(pending.shift()).catch(() => {});
      },
      async ice(c) {
        if (!pc.remoteDescription) pending.push(c);
        else await pc.addIceCandidate(c).catch(() => {});
      },
      close() { try { pc.close(); } catch (e) {} }
    };
  };

  /** Ограничить битрейт видео у отправителя (для слабых сетей и многих зрителей). */
  CC.limitBitrate = async function (pc, maxKbps) {
    for (const sender of pc.getSenders()) {
      if (!sender.track || sender.track.kind !== 'video') continue;
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = maxKbps * 1000;
      try { await sender.setParameters(p); } catch (e) {}
    }
  };

  global.CC = CC;
})(window);
