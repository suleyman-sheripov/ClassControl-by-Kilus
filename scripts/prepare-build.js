// Готовит сборку приложения учителя: ставит зависимости сервера урока (они кладутся рядом с программой).
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
execSync('npm install --omit=dev --no-audit --no-fund', { cwd: path.join(root, 'server'), stdio: 'inherit' });
fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
if (!fs.readdirSync(path.join(root, 'bin')).some(f => f.startsWith('cloudflared'))) {
  console.log('[build] cloudflared не найден в bin/ — приложение скачает его само при первом включении доступа из дома.');
}
