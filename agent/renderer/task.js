(function () {
  'use strict';
  const api = window.agentAPI;
  const root = document.getElementById('tasks');
  api.onTask(async (tasks) => {
    const info=await api.info();
    CC.renderStudentTasks(root, tasks, {
      onInteractive:(event,data)=>api.interactiveSend(event,data),
      workUrl:url=>info.serverAddress+url+'?socketId='+encodeURIComponent(info.socketId)+'&token='+encodeURIComponent(info.uploadToken),
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
