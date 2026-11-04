/* ClassControl — набор иконок (контур 1.6px). Вставляется в документ как SVG-спрайт,
   поэтому работает и из file://, и с сервера, без сети. Использование:
   <svg class="i"><use href="#i-monitor"/></svg> */
(function () {
  const P = {
    mark: '<rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" stroke="none"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
    monitor: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 20.5h8M12 16.5v4"/>',
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    board: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M7 20.5l3-4M17 20.5l-3-4M7 12l3-3 2.5 2.5L17 7"/>',
    pen: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 013 3L8 18.5 4 20z"/><path d="M13.5 7l3 3"/>',
    marker: '<path d="M9 15l-4 4h5l2-2"/><path d="M8.5 14.5l7-9.5 4 3-7 9.5z"/><path d="M8.5 14.5l4 3"/>',
    eraser: '<path d="M8.5 20H20M4.6 15.4l8.5-8.5a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L13 19a2 2 0 01-1.4.6H8.3a2 2 0 01-1.4-.6l-2.3-2.3a1.4 1.4 0 010-1.3z"/><path d="M9.5 10.5l5.5 5.5"/>',
    hand: '<path d="M18 11V6.5a1.5 1.5 0 00-3 0V11M15 10.5V4.5a1.5 1.5 0 00-3 0v6M12 10.5V5.5a1.5 1.5 0 00-3 0V12"/><path d="M18 8.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1.6a6 6 0 01-4.3-1.8L4.3 15.4a1.6 1.6 0 012.3-2.3L9 15.5V12"/>',
    raise: '<path d="M18 11V6.5a1.5 1.5 0 00-3 0V11M15 10.5V4.5a1.5 1.5 0 00-3 0v6M12 10.5V5.5a1.5 1.5 0 00-3 0V12"/><path d="M18 8.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1.6a6 6 0 01-4.3-1.8L4.3 15.4a1.6 1.6 0 012.3-2.3L9 15.5V12"/>',
    cast: '<path d="M2.5 8V6a2 2 0 012-2h15a2 2 0 012 2v12a2 2 0 01-2 2h-6"/><path d="M2.5 16a4 4 0 014 4M2.5 12a8 8 0 018 8"/><circle cx="2.8" cy="19.8" r=".6" fill="currentColor"/>',
    live: '<circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a6 6 0 000 8.4M16.2 7.8a6 6 0 010 8.4M5 5a10 10 0 000 14M19 5a10 10 0 010 14"/>',
    record: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
    'mic-off': '<path d="M9 9v2a3 3 0 005.1 2.1M15 9.3V6a3 3 0 00-5.7-1.3"/><path d="M18.5 11a6.5 6.5 0 01-.9 3.3M5.5 11a6.5 6.5 0 0010.6 5M12 17.5V21M3 3l18 18"/>',
    volume: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14a6.5 6.5 0 013.5 6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0115 0"/>',
    home: '<path d="M3.5 10.5L12 3.5l8.5 7"/><path d="M5.5 9v11.5h13V9"/><path d="M10 20.5v-6h4v6"/>',
    chat: '<path d="M20.5 14.5a2 2 0 01-2 2H8l-4.5 4V5.5a2 2 0 012-2h13a2 2 0 012 2z"/>',
    send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
    clip: '<path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9"/>',
    file: '<path d="M14 2.5H6.5a2 2 0 00-2 2v15a2 2 0 002 2h11a2 2 0 002-2V8z"/><path d="M14 2.5V8h5.5"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15l-5-5L5 21"/>',
    download: '<path d="M12 3.5v12M7 10.5l5 5 5-5M4 20.5h16"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/>',
    unlock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 017.7-1.5"/>',
    bell: '<path d="M6 8.5a6 6 0 0112 0c0 6.5 2.5 8 2.5 8h-17S6 15 6 8.5z"/><path d="M10.3 20a2 2 0 003.4 0"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
    link: '<path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1.2-1.2"/>',
    power: '<path d="M12 3v8.5"/><path d="M6.4 6.6a8 8 0 1011.2 0"/>',
    restart: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 3.5V8H8"/>',
    logout: '<path d="M9 20.5H5.5a2 2 0 01-2-2v-13a2 2 0 012-2H9"/><path d="M16 16.5l4.5-4.5L16 7.5M20.5 12H9"/>',
    list: '<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><circle cx="4" cy="6" r=".8" fill="currentColor"/><circle cx="4" cy="12" r=".8" fill="currentColor"/><circle cx="4" cy="18" r=".8" fill="currentColor"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    more: '<circle cx="5.5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="18.5" cy="12" r="1" fill="currentColor"/>',
    settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2h3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16 16"/>',
    pointer: '<path d="M5 3.5l13.5 7-6 1.6-2.6 5.9z"/><path d="M12.5 12.1l5 5"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    expand: '<path d="M14.5 3.5h6v6M9.5 20.5h-6v-6M20.5 3.5l-7 7M3.5 20.5l7-7"/>',
    shrink: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    undo: '<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H15a5 5 0 010 10h-3"/>',
    trash: '<path d="M4 6.5h16M9.5 6.5V4.5h5v2M6 6.5l1 14h10l1-14"/>',
    save: '<path d="M5 3.5h11l3.5 3.5v11.5a2 2 0 01-2 2h-12a2 2 0 01-2-2v-13a2 2 0 011.5-2z"/><path d="M8 3.5V8h7V3.5M7.5 20.5v-6h9v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>',
    'chevron-right': '<path d="M9 6l6 6-6 6"/>',
    'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
    alert: '<path d="M10.3 3.9L2.4 17.5a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
    share: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 20.5h8M12 16.5v4M12 13V7.5M9.5 10L12 7.5l2.5 2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    wifi: '<path d="M2 8.5a15 15 0 0120 0M5 12a10.5 10.5 0 0114 0M8.5 15.5a5.5 5.5 0 017 0"/><circle cx="12" cy="19" r=".8" fill="currentColor"/>',
    sidebar: '<rect x="3" y="3.5" width="18" height="17" rx="2"/><path d="M9 3.5v17"/>',
    'sidebar-right': '<rect x="3" y="3.5" width="18" height="17" rx="2"/><path d="M15 3.5v17"/>',
    door: '<path d="M14 3.5H6.5v17H14"/><path d="M14 3.5l5 2v13l-5 2z"/><path d="M11.5 12h.01"/>',
    qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18v2.5"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16 16M11 8v6M8 11h6"/>',
    focus: '<path d="M4 8.5V5.5a1.5 1.5 0 011.5-1.5H8.5M15.5 4h3A1.5 1.5 0 0120 5.5v3M20 15.5v3a1.5 1.5 0 01-1.5 1.5h-3M8.5 20h-3A1.5 1.5 0 014 18.5v-3"/><circle cx="12" cy="12" r="3"/>',
    signal: '<path d="M4 20v-3M9 20v-7M14 20V9M19 20V4"/>',
    tasks: '<rect x="4" y="3.5" width="16" height="17.5" rx="2"/><path d="M9 3.5V2.5h6v1M8.5 10l2 2 4-4M8.5 16h7"/>',
    inbox: '<path d="M3.5 13.5l2.6-8.2A2 2 0 018 4h8a2 2 0 011.9 1.3l2.6 8.2V18a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/><path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5"/>',
    poll: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z"/>',
    'power-off': '<path d="M12 3v8.5"/><path d="M6.4 6.6a8 8 0 1011.2 0"/><path d="M3 3l18 18"/>'
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">' +
    Object.keys(P).map(k => `<symbol id="i-${k}" viewBox="0 0 24 24">${P[k]}</symbol>`).join('') + '</svg>';
  function inject() {
    if (document.getElementById('cc-icons')) return;
    const holder = document.createElement('div');
    holder.id = 'cc-icons';
    holder.innerHTML = svg;
    document.body.insertBefore(holder, document.body.firstChild);
  }
  if (document.body) inject(); else document.addEventListener('DOMContentLoaded', inject);
  window.ccIcon = function (name, cls) {
    return `<svg class="i ${cls || ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  };
})();
