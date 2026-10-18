import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../frontend/public/sw.js', import.meta.url), 'utf8');
function worker(fetch) {
  const handlers = {};
  runInNewContext(source, { self: {
    location: { origin: 'https://router.test' },
    addEventListener: (name, handler) => { handlers[name] = handler; },
  }, fetch, Response, URL });
  return handlers.fetch;
}

test('leaves API, socket and external requests untouched', () => {
  const handle = worker(() => { throw new Error('Should not fetch'); });
  for (const [url, mode] of [
    ['https://router.test/api/sessions', 'cors'],
    ['https://router.test/socket.io/', 'cors'],
    ['https://other.test/', 'navigate'],
  ]) handle({ request: { url, mode }, respondWith: () => assert.fail('Intercepted private or external request') });
});

test('returns the live navigation response without caching', async () => {
  const live = new Response('live');
  const request = { url: 'https://router.test/chat', mode: 'navigate' };
  let response;
  worker(async received => { assert.equal(received, request); return live; })({ request, respondWith: value => { response = value; } });
  assert.equal(await response, live);
});

test('shows an offline retry page when navigation fails', async () => {
  let response;
  worker(async () => { throw new TypeError('Offline'); })({
    request: { url: 'https://router.test/chat', mode: 'navigate' },
    respondWith: value => { response = value; },
  });
  const offline = await response;
  assert.equal(offline.status, 503);
  assert.equal(offline.headers.get('cache-control'), 'no-store');
  assert.match(await offline.text(), /Нет соединения/);
});

test('manifest provides standalone launch and real PNG icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('../frontend/public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  for (const icon of manifest.icons) {
    const bytes = await readFile(new URL(`../frontend/public${icon.src}`, import.meta.url));
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});
