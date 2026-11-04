// Тема выбирается до первой отрисовки, чтобы не было вспышки.
// Порядок: явный выбор пользователя (localStorage) → тема системы. Следит за сменой темы системы.
(function () {
  var root = document.documentElement;
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function saved() { try { return localStorage.getItem('cc-theme'); } catch (e) { return null; } }
  function apply() {
    var s = saved();
    root.dataset.theme = (s === 'light' || s === 'dark') ? s : (mq && mq.matches ? 'dark' : 'light');
  }
  apply();
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  // Графика: auto | full | lite | min. «Авто» включает облегчённую графику на слабых компьютерах
  // (мало ядер или памяти): без размытия стекла и бесконечных анимаций — интерфейс тот же, нагрузка меньше.
  var forced = null;
  function savedPerf() { try { return localStorage.getItem('cc-perf'); } catch (e) { return null; } }
  function weak() {
    var n = navigator.hardwareConcurrency || 8, m = navigator.deviceMemory || 8;
    return n <= 4 || m <= 4;
  }
  function applyPerf() {
    var m = forced || savedPerf() || 'auto';
    if (m === 'auto') m = weak() ? 'lite' : 'full';
    if (m === 'full') delete root.dataset.perf; else root.dataset.perf = m;
  }
  applyPerf();
  window.CCPerf = {
    get: function () { return savedPerf() || 'auto'; },
    effective: function () { return root.dataset.perf || 'full'; },
    weak: weak,
    set: function (m) { try { if (m && m !== 'auto') localStorage.setItem('cc-perf', m); else localStorage.removeItem('cc-perf'); } catch (e) {} applyPerf(); },
    // Учитель включил облегчённую графику для класса — сильнее локального выбора
    force: function (m) { forced = m || null; applyPerf(); }
  };

  /** CCTheme.set('light' | 'dark' | 'auto') — с плавным переходом, если браузер умеет View Transitions. */
  window.CCTheme = {
    get: function () { return saved() || 'auto'; },
    set: function (t) {
      try { if (t === 'light' || t === 'dark') localStorage.setItem('cc-theme', t); else localStorage.removeItem('cc-theme'); } catch (e) {}
      if (document.startViewTransition && !root.dataset.perf && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) document.startViewTransition(apply);
      else apply();
    }
  };
})();
