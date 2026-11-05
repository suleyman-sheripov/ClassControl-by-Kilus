(function () {
  'use strict';
  const api = window.agentAPI;
  const root = document.getElementById('tasks');
  api.onTask((tasks) => {
    CC.renderStudentTasks(root, tasks, {
      onAnswer: (pollId, option) => api.taskAnswer(pollId, option),
      onSubmit: (collectId) => api.taskSubmit(collectId)
    });
  });
  document.getElementById('close').addEventListener('click', () => api.taskClose());
  // Быстрый ответ клавишами 1–8
  document.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= 8) document.querySelectorAll('.choice')[n - 1]?.click();
    if (e.key === 'Escape') api.taskClose();
  });
})();
