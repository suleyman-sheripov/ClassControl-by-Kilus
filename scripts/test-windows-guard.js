'use strict';
const { spawn } = require('node:child_process'),
  fs = require('node:fs'),
  path = require('node:path');
if (process.platform !== 'win32') {
  console.log('Windows native hook check: not applicable');
  process.exit(0);
}
const script = fs.readFileSync(
  path.join(__dirname, '../agent/platform/windows-classroom.ps1'),
  'utf8'
);
const child = spawn(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')
  ],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
);
let output = '',
  errors = '';
const timer = setTimeout(() => {
  child.kill();
  console.error('Windows hook startup timed out');
  process.exitCode = 1;
}, 20000);
child.stdout.on('data', (chunk) => {
  output += chunk;
  if (output.includes('READY') && !child.stdin.writableEnded)
    child.stdin.end('off\n');
});
child.stderr.on('data', (chunk) => (errors += chunk));
child.on('error', (err) => {
  clearTimeout(timer);
  console.error(err.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearTimeout(timer);
  if (code !== 0 || !output.includes('READY')) {
    console.error(errors || 'Native hook failed');
    process.exitCode = 1;
  } else
    console.log(
      'PASS: Windows C# hook compiled, installed and removed; helper exits on stdin EOF'
    );
});
