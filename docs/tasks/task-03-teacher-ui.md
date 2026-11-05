# Задача 3: UI Учителя — HTML + CSS

> **Контекст:** Читай `TZ.md` (раздел 4 — макет, раздел 4.2 — зоны, раздел 4.3 — карточка ПК).
> **Рабочие файлы:** `teacher/renderer/index.html`, `teacher/renderer/style.css`

## Цель
Создать полный HTML-макет и стили для главного окна учителя. 3-колоночный layout — по точному макету из TZ.md раздел 4.1.

## Файл: `teacher/renderer/index.html`

Структура DOM (создай именно такую иерархию, ID обязательны):

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>ClassControl — Учитель</title>
  <link rel="stylesheet" href="style.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>

  <!-- HEADER -->
  <header id="app-header">
    <div class="header-left">
      <button id="recordBtn" class="header-btn">🔴 Запись</button>
      <span id="record-timer" class="hidden">00:00</span>
    </div>
    <div class="header-center">
      <span class="app-title">ClassControl</span>
      <span id="room-name" class="room-label">Кабинет</span>
    </div>
    <div class="header-right">
      <span id="network-ip" class="network-info">IP: —</span>
    </div>
  </header>

  <!-- MAIN 3-COLUMN LAYOUT -->
  <main id="app-layout">

    <!-- LEFT: Онлайн-участники + Чат -->
    <aside id="left-panel">
      <section id="online-users-section">
        <h3 class="panel-title">🌐 Онлайн <span id="online-count" class="badge">0</span></h3>
        <ul id="online-users-list"></ul>
      </section>
      <section id="chat-section">
        <h3 class="panel-title">💬 Чат</h3>
        <div id="chat-messages"></div>
        <div id="chat-input-area">
          <button id="chat-attach-btn" title="Прикрепить файл">📎</button>
          <input type="file" id="chat-file-input" class="hidden">
          <input type="text" id="chat-text-input" placeholder="Сообщение...">
          <button id="chat-send-btn">→</button>
        </div>
      </section>
    </aside>

    <!-- CENTER: Табы + контент -->
    <section id="center-panel">
      <nav id="center-tabs">
        <button id="tab-monitoring" class="tab-btn active">💻 Мониторинг</button>
        <button id="tab-whiteboard" class="tab-btn">🖍️ Доска</button>
      </nav>
      <div id="monitoring-grid">
        <!-- Карточки ПК появляются здесь динамически из script.js -->
      </div>
      <div id="whiteboard-container" class="hidden">
        <canvas id="whiteboard"></canvas>
      </div>
    </section>

    <!-- RIGHT: Студия эфира -->
    <aside id="right-panel">
      <section id="broadcast-section">
        <h3 class="panel-title">📺 Студия эфира</h3>
        <div id="broadcast-preview">
          <video id="preview-video" autoplay playsinline muted></video>
          <div id="preview-placeholder">Нет трансляции</div>
        </div>
        <button id="btn-start-broadcast" class="btn btn-success">▶ Начать эфир</button>
        <button id="btn-stop-broadcast" class="btn btn-danger hidden">⏹ Остановить</button>
      </section>

      <section id="broadcast-settings">
        <h3 class="panel-title">⚙️ Настройки</h3>
        <div class="setting-row">
          <label>Качество</label>
          <select id="quality-select">
            <option value="1920x1080">FHD (1080p)</option>
            <option value="1280x720" selected>HD (720p)</option>
            <option value="854x480">SD (480p)</option>
            <option value="640x360">Low (360p)</option>
          </select>
        </div>
        <div class="setting-row">
          <label>FPS</label>
          <div class="fps-toggle">
            <button id="fps30" class="fps-btn active">30</button>
            <button id="fps60" class="fps-btn">60</button>
          </div>
        </div>
      </section>

      <section id="whiteboard-tools-section" class="hidden">
        <h3 class="panel-title">🎨 Доска</h3>
        <div class="tool-buttons">
          <button id="tool-brush" class="tool-btn active">✏️ Кисть</button>
          <button id="tool-eraser" class="tool-btn">🧽 Ластик</button>
        </div>
        <div id="brush-color-row" class="setting-row">
          <label>Цвет</label>
          <input type="color" id="color-picker" value="#0ea5e9">
        </div>
        <div class="setting-row">
          <label>Толщина</label>
          <input type="range" id="line-width" min="1" max="20" value="3">
        </div>
        <button id="clear-canvas-btn" class="btn btn-secondary">Очистить</button>
      </section>
    </aside>
  </main>

  <!-- STATUS BAR -->
  <footer id="status-bar">
    <span>👥 Агентов: <strong id="agents-count">0</strong></span>
    <span>🌐 Онлайн: <strong id="online-status-count">0</strong></span>
    <span id="status-text"></span>
  </footer>

  <!-- MODAL: Удалённое управление -->
  <div id="remote-modal" class="modal hidden">
    <div class="modal-header">
      <span id="remote-modal-title">Управление ПК</span>
      <button id="remote-modal-close">✕</button>
    </div>
    <div class="modal-body">
      <video id="remote-video" autoplay playsinline></video>
      <div id="remote-mouse-catcher"></div>
    </div>
  </div>

  <!-- MODAL: Демо онлайн-участника -->
  <div id="online-demo-modal" class="modal hidden">
    <div class="modal-header">
      <span id="online-demo-title">Демонстрация</span>
      <span id="online-demo-timer">05:00</span>
      <button id="online-demo-close">✕ Закрыть</button>
    </div>
    <div class="modal-body">
      <video id="online-demo-video" autoplay playsinline></video>
    </div>
  </div>

  <script src="script.js"></script>
</body>
</html>
```

## Файл: `teacher/renderer/style.css`

Создай полноценный CSS. Ключевые требования к дизайну:

**CSS-переменные (обязательно в `:root`):**
```css
:root {
  --bg-primary: #0f1117;
  --bg-secondary: #1a1d27;
  --bg-tertiary: #252836;
  --bg-hover: #2d3040;
  --border: rgba(255,255,255,0.08);
  --text: #e4e4e7;
  --text-muted: #71717a;
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --success: #10b981;
  --danger: #ef4444;
  --warning: #f59e0b;
  --radius-sm: 8px;
  --radius-md: 12px;
  --font: 'Inter', -apple-system, sans-serif;
}
```

**Правила стилизации:**

1. `body`: margin 0, bg `--bg-primary`, color `--text`, font `--font`, height 100vh, display flex, flex-direction column, overflow hidden.

2. `#app-header`: height 48px, bg `--bg-secondary`, border-bottom `1px solid var(--border)`, display flex, align-items center, justify-content space-between, padding 0 16px.

3. `#app-layout`: flex 1, display grid, `grid-template-columns: 300px 1fr 300px`, overflow hidden.

4. `#left-panel`, `#right-panel`: bg `--bg-secondary`, border `1px solid var(--border)`, display flex, flex-direction column, overflow-y auto.

5. `#center-panel`: display flex, flex-direction column, overflow hidden.

6. `#center-tabs`: display flex, gap 4px, padding 8px 12px, bg `--bg-secondary`, border-bottom.

7. `.tab-btn`: padding 8px 20px, border-radius 6px, bg transparent, color `--text-muted`, cursor pointer, transition 0.2s. `.tab-btn.active`: bg `--accent`, color white.

8. `#monitoring-grid`: flex 1, display grid, `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`, gap 12px, padding 12px, overflow-y auto.

9. `.pc-card`: bg `--bg-secondary`, border `1px solid var(--border)`, border-radius `--radius-sm`, overflow hidden, cursor pointer, transition 0.2s. `:hover`: border-color `--accent`, transform scale(1.02).

10. `.pc-card .screenshot`: width 100%, aspect-ratio 16/9, bg black, object-fit cover.

11. `.pc-card .pc-name`: padding 8px 12px, font-size 0.85rem, font-weight 500.

12. `#whiteboard-container`: flex 1, bg #1a1a2e, position relative. `#whiteboard`: width 100%, height 100%.

13. `#broadcast-preview`: width 100%, aspect-ratio 16/9, bg black, border-radius `--radius-sm`, overflow hidden, margin-bottom 12px.

14. `#chat-messages`: flex 1, overflow-y auto, padding 8px. `.chat-msg`: margin-bottom 8px, font-size 0.85rem. `.chat-msg .sender`: font-weight 600, color `--accent`.

15. `#chat-input-area`: display flex, gap 4px, padding 8px, border-top. `#chat-text-input`: flex 1, bg `--bg-tertiary`, border 1px solid `--border`, color white, padding 8px, border-radius 6px.

16. `.btn`: padding 10px, border-radius 6px, border none, cursor pointer, font-weight 500, transition 0.2s. `.btn-success`: bg `--success`, color white. `.btn-danger`: bg `--danger`, color white. `.btn-secondary`: bg `--bg-tertiary`, color `--text`.

17. `.modal`: position fixed, top 0, left 0, width 100%, height 100%, bg rgba(0,0,0,0.85), z-index 1000, display flex, flex-direction column. `.modal-body`: flex 1, position relative. `.modal video`: width 100%, height 100%, object-fit contain.

18. `#status-bar`: height 32px, bg `--bg-secondary`, border-top, display flex, align-items center, gap 24px, padding 0 16px, font-size 0.8rem, color `--text-muted`.

19. `.hidden`: display none !important.

20. `.badge`: bg `--accent`, color white, font-size 0.7rem, padding 2px 6px, border-radius 10px. `.panel-title`: font-size 0.85rem, font-weight 600, padding 12px, border-bottom 1px solid var(--border), margin 0.

## ✅ Проверка завершения
Запусти `cd teacher && cmd /c npm start` и визуально проверь:
- [ ] 3-колоночный layout виден (левая панель, центр, правая панель).
- [ ] Тёмная тема, шрифт Inter.
- [ ] Табы «Мониторинг» и «Доска» видны сверху по центру.
- [ ] Правая панель: превью, настройки качества/FPS, кнопка «Начать эфир».
- [ ] Левая панель: список онлайн-участников и блок чата.
- [ ] Статус-бар внизу.
