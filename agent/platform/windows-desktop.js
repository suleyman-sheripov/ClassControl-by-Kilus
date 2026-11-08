'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
// Keep one owner: unlocking must not show the taskbar while a presentation is active.
module.exports = function desktopGuard({
  enabled = process.platform === 'win32',
  onError = console.error,
  spawnProcess = spawn
} = {}) {
  let child = null,
    locked = false,
    presentation = false,
    ready = false,
    warmup = false;
  const mode = () => (locked ? 'lock' : presentation ? 'presentation' : 'off');
  function update() {
    if (!enabled) return;
    if (!child && (mode() !== 'off' || warmup)) {
      ready = false;
      warmup = false;
      child = spawnProcess(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(
            fs.readFileSync(
              path.join(__dirname, 'windows-classroom.ps1'),
              'utf8'
            ),
            'utf16le'
          ).toString('base64')
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const own = child;
      let output = '';
      child.stdout.on('data', (data) => {
        output = (output + String(data)).slice(-4096);
        if (output.includes('READY')) {
          ready = true;
          update();
        }
      });
      child.stderr.on('data', (data) =>
        onError('[AGENT] Защита рабочего стола: ' + String(data).slice(0, 500))
      );
      child.stdin.on('error', () => {});
      child.on('error', (err) =>
        onError('[AGENT] Защита рабочего стола: ' + err.message)
      );
      child.on('exit', () => {
        if (child === own) {
          child = null;
          ready = false;
        }
      });
    }
    if (child && ready) child.stdin.write(mode() + '\n');
  }
  return {
    prepare() {
      warmup = true;
      update();
    },
    lock(on) {
      locked = Boolean(on);
      update();
    },
    present(on) {
      presentation = Boolean(on);
      update();
    },
    close() {
      locked = presentation = false;
      if (child) {
        if (ready) child.stdin.write('off\n');
        child.stdin.end();
      }
    }
  };
};
