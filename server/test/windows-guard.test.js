'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
// Native hook installation is tested on Windows CI; this verifies the shared ownership invariant.
// The controller takes an injected process factory, so this test never alters the host desktop.
test('unlocking preserves presentation taskbar state and shutdown closes the helper', () => {
  let process,
    starts = 0,
    commands = '';
  const guard = require('../../agent/platform/windows-desktop')({
    enabled: true,
    onError: () => {},
    spawnProcess: () => {
      starts++;
      process = new EventEmitter();
      process.stdin = new PassThrough();
      process.stdout = new PassThrough();
      process.stderr = new PassThrough();
      process.stdin.on('data', (chunk) => (commands += chunk));
      return process;
    }
  });
  guard.prepare();
  guard.present(true);
  assert.equal(starts, 1);
  assert.equal(commands, '');
  process.stdout.write('REA');
  assert.equal(commands, '');
  process.stdout.write('DY\n');
  guard.lock(true);
  guard.lock(false);
  guard.present(false);
  guard.close();
  assert.deepEqual(commands.trim().split('\n'), [
    'presentation',
    'lock',
    'presentation',
    'off',
    'off'
  ]);
  assert.equal(process.stdin.writableEnded, true);
});
