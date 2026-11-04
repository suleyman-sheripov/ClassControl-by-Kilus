const d = new Date();
document.getElementById('time').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
window.agentAPI.onMessage(({ text, from }) => {
  document.getElementById('text').textContent = text;
  document.getElementById('from').textContent = from || 'Учитель';
  document.getElementById('ok').focus();
});
document.getElementById('ok').addEventListener('click', () => window.agentAPI.closeMessage());
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') window.agentAPI.closeMessage(); });
