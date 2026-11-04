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
  /** CCTheme.set('light' | 'dark' | 'auto') — с плавным переходом, если браузер умеет View Transitions. */
  window.CCTheme = {
    get: function () { return saved() || 'auto'; },
    set: function (t) {
      try { if (t === 'light' || t === 'dark') localStorage.setItem('cc-theme', t); else localStorage.removeItem('cc-theme'); } catch (e) {}
      if (document.startViewTransition && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) document.startViewTransition(apply);
      else apply();
    }
  };
})();
