const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { startupDiagnostics, exitMessage } = require('../src/diagnostics.cjs');

test('captures actual stderr through process close and retains the failure reason', async () => {
  const log = startupDiagnostics();
  const child = spawn(process.execPath, ['-e', "console.error('Error: Pairing failed: 401'); process.exitCode = 1"]);
  child.stdout.on('data', chunk => log.append(chunk));
  child.stderr.on('data', chunk => log.append(chunk));
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 1);
  assert.match(log.text(), /Pairing failed: 401/);
  assert.match(exitMessage(code, null, log.text()), /новый одноразовый код/);
});

test('redacts a pairing code split across chunks and common credentials', () => {
  const log = startupDiagnostics(['pairing-value']);
  log.append('\x1b[31mError: pairing-');
  log.append('value\x1b[0m Authorization: Bearer token-value\n{"secret":"device-value"}');
  assert.doesNotMatch(log.text(), /pairing-value|token-value|device-value|\x1b/);
  assert.match(log.text(), /Error: \[скрыто\]/);
});

test('bounds logs and distinguishes network errors from unknown failures', () => {
  const log = startupDiagnostics();
  log.append('x'.repeat(50000));
  log.append('\nError: sandbox initialization failed');
  assert.ok(log.text().length <= 6000);
  assert.match(log.text(), /sandbox initialization failed/);
  assert.doesNotMatch(exitMessage(1, null, log.text()), /код подключения/);
  assert.match(exitMessage(1, null, 'fetch failed: ENOTFOUND'), /адрес и сеть/);
  assert.match(exitMessage(null, 'SIGABRT', ''), /SIGABRT/);
});
