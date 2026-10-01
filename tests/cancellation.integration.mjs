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


test('HTTP cancellation stops a running job, checks ownership and never falls back', { timeout: 30000 }, async () => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'router-cancellation-'));
 const port = await freePort(), previewPort = await freePort(), base = 'http://127.0.0.1:' + port;
 const backend = spawn(process.execPath, [path.join(repo, 'backend/dist/server.js')], { cwd: repo,
  env: { ...process.env, DATA_DIR: root, PORT: String(port), PREVIEW_PORT: String(previewPort),
   ADMIN_PASSWORD: 'cancel-test-password', SESSION_SECRET: 'cancel-secret-longer-than-thirty-two-characters', COOKIE_SECURE: 'false' }, stdio: 'ignore' });
 let runner, browser;
 try {
  await waitFor(async () => (await fetch(base + '/api/health')).ok);
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
   body: JSON.stringify({ username: 'admin', password: 'cancel-test-password' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const api = async (url, method = 'GET', body) => {
   const response = await fetch(base + '/api' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
   assert.ok(response.ok, url + ':' + response.status); return response.json();
  };
  const pairing = await api('/runners/pairing', 'POST', { name: 'Cancellation runner' });
  const device = await (await fetch(base + '/api/runner/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code }) })).json();
  runner = await connect(base + '/runner', { auth: { runnerId: device.id, secret: device.secret } });
  browser = await connect(base, { extraHeaders: { cookie } });
  await api('/accounts', 'POST', { provider: 'codex', name: 'First', runnerId: device.id });
  await api('/accounts', 'POST', { provider: 'codex', name: 'Fallback', runnerId: device.id });
  const chat = await api('/sessions', 'POST', {});
  let job, starts = 0;
  runner.on('job:start', (value, ack) => { job = value; starts++; ack({ ok: true });
   runner.emit('job:event', { jobId: job.jobId, type: 'checkpoint', data: { status: 'running' } }); });
  const canceled = new Promise(resolve => runner.on('job:cancel', value => { assert.equal(value.jobId, job.jobId); resolve(); }));
  const ended = new Promise(resolve => browser.on('ai:event', event => { if (event.type === 'error') resolve(event); }));
  const run = await browser.timeout(3000).emitWithAck('run', { sessionId: chat.id, prompt: 'Long task', accountId: 'auto', model: 'default', mode: 'task' });
  assert.equal(run.ok, true);
  await waitFor(() => !!job);
  const register = await fetch(base + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'other-canceller', password: 'cancel-test-password' }) });
  const foreign = await fetch(base + '/api/tasks/' + run.runId, { method: 'DELETE', headers: { cookie: register.headers.get('set-cookie').split(';')[0] } });
  assert.equal(foreign.status, 404);
  assert.equal((await api('/tasks')).find(task => task.id === run.runId).state, 'running');
  await api('/tasks/' + run.runId, 'DELETE');
  await canceled;
  assert.equal((await ended).message, 'Stopped by user');
  await waitFor(async () => (await api('/tasks')).find(task => task.id === run.runId).state === 'canceled');
  assert.equal(starts, 1);
  assert.equal((await api('/tasks')).find(task => task.id === run.runId).recovery.checkpoint, true);
  runner.emit('job:result', { jobId: job.jobId, ok: true, text: 'Late answer' });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await api('/tasks')).find(task => task.id === run.runId).state, 'canceled');
  assert.deepEqual((await api('/sessions/' + chat.id)).messages.map(message => message.text), ['Long task']);
 } finally {
  runner?.disconnect(); browser?.disconnect(); backend.kill('SIGTERM');
  await new Promise(resolve => backend.once('exit', resolve));
  await rm(root, { recursive: true, force: true });
 }
});
