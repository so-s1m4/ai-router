const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdates } = require('../src/updates.cjs');
function release(number, arch = 'arm64') {
  const tag_name = `desktop-v${number}`, name = `AI-Router-${number}-${arch}.dmg`;
  return { tag_name, assets: [{ name, browser_download_url: `https://github.com/so-s1m4/ai-router/releases/download/${tag_name}/${name}` }] };
}
function fixture(options = {}) {
  const messages = [], opened = [], calls = [];
  const controller = createUpdates({ app: { isPackaged: true, getVersion: () => '0.1.7' }, platform: 'darwin', arch: 'arm64',
    dialog: { async showMessageBox(message) { messages.push(message); return { response: options.response ?? 0 }; } },
    openExternal: async url => opened.push(url),
    fetchRelease: async () => { calls.push('check'); return { ok: true, json: async () => options.releases ?? [] }; },
    schedule(fn, delay) { calls.push(delay); return { unref() {} }; }, cancel() { calls.push('cancel'); }, ...options });
  return { messages, opened, calls, controller };
}
test('checks at startup and every four hours, notifying once until a manual check', async () => {
  const f = fixture({ releases: [release('0.1.8')] });
  f.controller.start(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, ['check', 14400000]);
  assert.equal(f.opened.length, 1);
  await f.controller.check(); assert.equal(f.messages.length, 1);
  await f.controller.check(true); assert.equal(f.messages.length, 2);
  f.controller.dispose(); assert.equal(f.calls.at(-1), 'cancel');
});
test('selects newest complete stable release for this architecture, ignoring other releases and URLs', async () => {
  const malicious = release('9.0.0'); malicious.assets[0].browser_download_url = 'https://evil.example/download.dmg';
  const f = fixture({ releases: [release('0.1.7'), release('0.1.9'), release('0.1.10'), release('0.1.11', 'x64'),
    { ...release('0.2.0'), prerelease: true }, { ...release('0.3.0'), draft: true }, { tag_name: 'backend-v9.0.0' }, malicious] });
  await f.controller.check(true);
  assert.deepEqual(f.opened, [release('0.1.10').assets[0].browser_download_url]);
});
test('declining never opens the browser; up-to-date background checks are silent', async () => {
  const f = fixture({ response: 1, releases: [release('0.1.8')] });
  await f.controller.check(true); assert.deepEqual(f.opened, []);
  const current = fixture({ releases: [release('0.1.7'), release('0.1.6')] });
  await current.controller.check(); assert.equal(current.messages.length, 0);
  await current.controller.check(true); assert.match(current.messages[0].message, /последняя/);
});
test('network failures stay silent in background and manual checks can retry', async () => {
  let fails = true;
  const f = fixture({ fetchRelease: async () => { if (fails) throw Error('offline'); return { ok: true, json: async () => [] }; } });
  await f.controller.check(); assert.equal(f.messages.length, 0);
  await f.controller.check(true); assert.match(f.messages.at(-1).message, /Не удалось/);
  fails = false; await f.controller.check(true); assert.match(f.messages.at(-1).message, /последняя/);
});
test('development builds never contact release servers', async () => {
  const f = fixture({ app: { isPackaged: false } });
  f.controller.start(); await f.controller.check(true); assert.deepEqual(f.calls, []);
});
