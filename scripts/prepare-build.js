// Готовит сборку приложения учителя: ставит зависимости сервера урока (они кладутся рядом с программой).
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
execSync('npm ci --no-audit --no-fund', { cwd: path.join(root, 'server'), stdio: 'inherit' });
// Target-specific cloudflared is downloaded and SHA-256 verified by before-pack.js.
