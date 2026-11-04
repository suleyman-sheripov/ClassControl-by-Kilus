// Тема выбирается до отрисовки страницы, чтобы не было вспышки
try { if (localStorage.getItem('cc-theme') === 'light') document.documentElement.dataset.theme = 'light'; } catch (e) {}
