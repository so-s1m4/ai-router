const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../src/updates.cjs');

function fixture(options = {}) {
  const updater = new EventEmitter(), messages = [], calls = [];
  updater.checkForUpdates = async () => { calls.push('check'); return null; };
  updater.quitAndInstall = () => calls.push('install');
  const controller = createUpdates({ app: { isPackaged: true }, platform: 'darwin', updater,
    dialog: { async showMessageBox(message) { messages.push(message); return { response: options.response ?? 0 }; } },
    stopProcesses: async () => { calls.push('stop'); if (options.stopFails) throw Error('stop'); },
    schedule(fn, delay) { calls.push(delay); return { unref() {} }; }, cancel() { calls.push('cancel'); }, ...options });
  return { updater, messages, calls, controller };
}
test('checks on startup and schedules background checks; installs only after stopping commands', async () => {
  const f = fixture();
  f.controller.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, ['check', 14400000]);
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.autoInstallOnAppQuit, true);
  await f.controller.install();
  assert.ok(!f.calls.includes('install'));
  f.updater.emit('update-downloaded');
  await f.controller.install();
  assert.deepEqual(f.calls.slice(-2), ['stop', 'install']);
  f.controller.dispose();
  assert.equal(f.calls.at(-1), 'cancel');
});
test('declined restart and failed command shutdown never install', async () => {
  for (const options of [{ response: 1 }, { stopFails: true }]) {
    const f = fixture(options);
    f.updater.emit('update-downloaded');
    await f.controller.install();
    assert.ok(!f.calls.includes('install'));
  }
});
test('background download failures are handled; manual failures are visible and retryable', async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => ({ downloadPromise: Promise.reject(Error('offline')) });
  await f.controller.check();
  assert.equal(f.messages.length, 0);
  await f.controller.check(true);
  assert.match(f.messages.at(-1).message, /Не удалось/);
  f.updater.checkForUpdates = async () => null;
  await f.controller.check(true);
  assert.match(f.messages.at(-1).message, /последняя/);
});
test('development builds do not contact release servers', async () => {
  const f = fixture({ app: { isPackaged: false } });
  f.controller.start(); await f.controller.check(true);
  assert.deepEqual(f.calls, []);
});
