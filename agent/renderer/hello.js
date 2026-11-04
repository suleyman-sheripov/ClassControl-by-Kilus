(function () {
  'use strict';
  const api = window.agentAPI;
  api.info().then((i) => { if (i.student) document.getElementById('name').value = i.student; });
  document.getElementById('form').addEventListener('submit', (e) => {
    e.preventDefault();
    api.setStudent(document.getElementById('name').value);
  });
  document.getElementById('skip').addEventListener('click', () => api.helloSkip());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.helloSkip(); });
})();
