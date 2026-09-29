import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { io } = createRequire(path.join(repo, 'runner/package.json'))('socket.io-client');

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(fn) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await fn()) return; } catch { /* service is starting */ }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('Timed out waiting for service');
}

async function connect(url, options) {
  const socket = io(url, { transports: ['websocket'], forceNew: true, ...options });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

test('per-request usage survives history reload, duplicate snapshots and account handoff', { timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'router-token-usage-'));
  const port = await freePort(), previewPort = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const backend = spawn(process.execPath, [path.join(repo, 'backend/dist/server.js')], {
    cwd: repo,
    env: { ...process.env, DATA_DIR: root, PORT: String(port), PREVIEW_PORT: String(previewPort), ADMIN_PASSWORD: 'token-test-password', SESSION_SECRET: 'token-test-secret-longer-than-thirty-two-characters', COOKIE_SECURE: 'false' },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  let runner, browser;
  try {
    await waitFor(async () => (await fetch(base + '/api/health')).ok);
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'token-test-password' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const api = async (url, method = 'GET', body) => {
      const response = await fetch(base + '/api' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      assert.ok(response.ok, `${method} ${url}: ${response.status}`);
      return response.json();
    };
    const pairing = await api('/runners/pairing', 'POST', { name: 'Token test runner' });
    const enrolled = await fetch(base + '/api/runner/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code }) });
    const device = await enrolled.json();
    runner = await connect(base + '/runner', { auth: { runnerId: device.id, secret: device.secret } });
    browser = await connect(base, { extraHeaders: { cookie } });
    const first = await api('/accounts', 'POST', { provider: 'codex', name: 'First', runnerId: device.id });
    const second = await api('/accounts', 'POST', { provider: 'codex', name: 'Second', runnerId: device.id });
    await api('/accounts/' + first.id + '/priority', 'PATCH', { priority: 2 });
    const session = await api('/sessions', 'POST', {});
    let request = 0;
    const attemptedAccounts = [];
    runner.on('job:start', (job, ack) => {
      ack({ ok: true });
      attemptedAccounts.push(job.accountId);
      const usage = data => runner.emit('job:event', { jobId: job.jobId, type: 'usage', data });
      if (request === 1) {
        usage({ input_tokens: 90000, cached_input_tokens: 80000, output_tokens: 10000 });
        usage({ input_tokens: 190000, cached_input_tokens: 180000, output_tokens: 10000 });
        usage({ input_tokens: 190000, cached_input_tokens: 180000, output_tokens: 10000 });
        usage({ limits: { primary: { usedPercent: 20 } } });
      } else if (request === 2) {
        usage({ totalTokens: 300, inputTokens: 250, outputTokens: 50 });
      } else if (request === 4) {
        usage({ totalTokens: job.accountId === first.id ? 120000 : 80000 });
        if (job.accountId === first.id) {
          runner.emit('job:result', { jobId: job.jobId, ok: false, error: 'usage limit reached', code: 'rate_limit' });
          return;
        }
      }
      runner.emit('job:result', { jobId: job.jobId, ok: true, text: 'Answer ' + request });
    });
    const run = async accountId => {
      request++;
      const finished = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Run did not finish')), 5000);
        const handler = event => {
          if (event.sessionId !== session.id || !['completed', 'error'].includes(event.type)) return;
          clearTimeout(timer); browser.off('ai:event', handler);
          event.type === 'error' ? reject(new Error(event.message)) : resolve();
        };
        browser.on('ai:event', handler);
      });
      const ack = await browser.timeout(5000).emitWithAck('run', { sessionId: session.id, prompt: 'Request ' + request, accountId, model: 'default' });
      assert.equal(ack.ok, true);
      await finished;
      return api('/sessions/' + session.id);
    };
    let history = await run(first.id);
    assert.deepEqual(history.messages.at(-1).tokenUsage, { totalTokens: 200000, inputTokens: 190000, outputTokens: 10000, cachedInputTokens: 180000 });
    history = await run(first.id);
    assert.equal(history.messages.at(-1).tokenUsage.totalTokens, 300, 'new requests do not inherit earlier usage');
    history = await run(first.id);
    assert.equal(history.messages.at(-1).tokenUsage, undefined, 'missing provider usage stays unknown');
    history = await run('codex');
    assert.deepEqual(attemptedAccounts.slice(-2), [first.id, second.id]);
    assert.equal(history.messages.at(-1).tokenUsage.totalTokens, 200000, 'usage includes the account that hit its limit');
    const reloaded = await api('/sessions/' + session.id);
    assert.deepEqual(reloaded.messages.filter(message => message.role === 'assistant').map(message => message.tokenUsage?.totalTokens), [200000, 300, undefined, 200000]);
  } finally {
    browser?.disconnect(); runner?.disconnect();
    const exited = new Promise(resolve => backend.once('exit', resolve));
    backend.kill('SIGTERM');
    await exited;
    await rm(root, { recursive: true, force: true });
  }
});
