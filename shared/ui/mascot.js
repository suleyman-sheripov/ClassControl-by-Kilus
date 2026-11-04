/*
 * ClassControl — «Указка», маскот продукта.
 * Мягкая градиентная рука-указатель (как старинный типографский знак ☞): без лица, без глаз, без рта —
 * это вещь, а не персонаж. Появляется только в особые моменты: показывает, куда смотреть или что нажать.
 *
 *   <cc-finger point="right" motion="nudge" size="96"></cc-finger>
 *
 * point  — куда указывает: right | down-right | down | down-left | left | up-left | up | up-right
 * motion — float (парит) | nudge (показывает на цель) | tap (нажимает) | raise (рука поднята) | none
 * size   — сторона в пикселях (по умолчанию 96)
 *
 * Анимации — только transform и opacity (видеокарта), с мягкой пружиной; prefers-reduced-motion их выключает.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.customElements || customElements.get('cc-finger')) return;

  // [поворот, отражение]: базовый рисунок указывает вправо; влево — зеркально, чтобы рука не переворачивалась
  const AIM = {
    right: [0, 1], 'down-right': [45, 1], down: [90, 1], 'down-left': [-45, -1],
    left: [0, -1], 'up-left': [45, -1], up: [-90, 1], 'up-right': [-45, 1]
  };
  let uid = 0;

  // Части руки — одним списком: из них и рисунок, и маска для бликов
  const PARTS = [
    '<rect x="16" y="34" width="50" height="64" rx="24"/>',                                   // тыльная сторона
    '<rect x="40" y="84" width="27" height="14" rx="7" data-s/>',                              // мизинец
    '<rect x="40" y="71" width="33" height="16" rx="8" data-s/>',                              // безымянный
    '<rect x="40" y="57" width="37" height="17" rx="8.5" data-s/>',                            // средний
    '<rect x="34" y="36" width="76" height="21" rx="10.5" data-s/>',                           // указательный
    '<rect x="22" y="58" width="40" height="15" rx="7.5" transform="rotate(14 42 65)" data-s/>' // большой
  ];

  function svg(id) {
    const fill = PARTS.map(p => p.replace(' data-s/>', ` fill="url(#${id}b)" filter="url(#${id}d)"/>`).replace('rx="24"/>', `rx="24" fill="url(#${id}b)"/>`)).join('');
    const clip = PARTS.map(p => p.replace(' data-s/>', '/>')).join('');
    return `
<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="18" y1="30" x2="100" y2="100">
      <stop offset="0" stop-color="var(--finger-a)"/><stop offset=".38" stop-color="var(--finger-b)"/>
      <stop offset=".72" stop-color="var(--finger-c)"/><stop offset="1" stop-color="var(--finger-d)"/>
    </linearGradient>
    <radialGradient id="${id}l" gradientUnits="userSpaceOnUse" cx="36" cy="34" r="66">
      <stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset=".5" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".55" stop-color="#2a1f7a" stop-opacity="0"/><stop offset="1" stop-color="#2a1f7a" stop-opacity=".16"/>
    </linearGradient>
    <filter id="${id}d" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.4" flood-color="#3a2b96" flood-opacity=".26"/></filter>
    <filter id="${id}g" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="1.4"/></filter>
    <clipPath id="${id}c">${clip}</clipPath>
  </defs>
  <ellipse class="finger__shadow" cx="60" cy="106" rx="30" ry="4" fill="var(--finger-shadow)"/>
  <g class="finger__float"><g class="finger__aim"><g class="finger__move">
    ${fill}
    <g clip-path="url(#${id}c)"><rect width="120" height="120" fill="url(#${id}s)"/><rect width="120" height="120" fill="url(#${id}l)"/></g>
    <rect x="54" y="39.5" width="46" height="4.6" rx="2.3" fill="#fff" opacity=".72" filter="url(#${id}g)"/>
    <rect x="22" y="44" width="4" height="22" rx="2" fill="#fff" opacity=".45" filter="url(#${id}g)"/>
  </g></g></g>
</svg>`;
  }

  class Finger extends HTMLElement {
    static get observedAttributes() { return ['point', 'size']; }
    connectedCallback() {
      if (!this.firstElementChild) this.innerHTML = svg('ccf' + (++uid));
      this.setAttribute('aria-hidden', 'true');
      this.sync();
    }
    attributeChangedCallback() { if (this.isConnected) this.sync(); }
    sync() {
      const [turn, flip] = AIM[this.getAttribute('point')] || AIM.right;
      this.style.setProperty('--finger-turn', turn + 'deg');
      this.style.setProperty('--finger-flip', flip);
      const size = parseFloat(this.getAttribute('size'));
      if (size) this.style.setProperty('--finger-size', size + 'px');
    }
  }
  customElements.define('cc-finger', Finger);

  /** Маскот из кода: CC.finger({ point: 'right', motion: 'nudge', size: 64 }) */
  window.CC = window.CC || {};
  window.CC.finger = (opts = {}) => {
    const f = document.createElement('cc-finger');
    f.setAttribute('point', opts.point || 'right');
    if (opts.motion) f.setAttribute('motion', opts.motion);
    if (opts.size) f.setAttribute('size', opts.size);
    if (opts.class) f.className = opts.class;
    return f;
  };
})();
