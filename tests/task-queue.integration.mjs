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

test('queue serializes runner work, supports priorities, cancellation and usage summary', { timeout: 30000 }, async () => {
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

    const session = await api('/sessions', 'POST', {});
    const jobs=[];
    runner.on('job:start',(job,ack)=>{ack({ok:true});jobs.push(job);});
    const submit=prompt=>browser.timeout(5000).emitWithAck('run',{sessionId:session.id,prompt,accountId:first.id,model:'default'});
    const one=await submit('First task');
    await waitFor(()=>jobs.length===1);
    const two=await submit('Low priority task');
    const three=await submit('High priority task');
    const canceled=await submit('Never execute this task');
    await api('/tasks/'+two.runId,'PATCH',{priority:0});
    await api('/tasks/'+three.runId,'PATCH',{priority:2});
    await api('/tasks/'+canceled.runId,'DELETE');
    assert.equal(jobs.length,1,'runner should execute one job at a time');
    let rows=await api('/tasks');
    assert.equal(rows.find(t=>t.id===canceled.runId).state,'canceled');
    await waitFor(async()=> (await api('/tasks')).find(t=>t.id===three.runId).message.includes('Waiting'));
    runner.emit('job:event',{jobId:jobs[0].jobId,type:'usage',data:{totalTokens:123}});
    runner.emit('job:event',{jobId:jobs[0].jobId,type:'usage',data:{totalTokens:123}});
    runner.emit('job:result',{jobId:jobs[0].jobId,ok:true,text:'First answer'});
    await waitFor(()=>jobs.length===2);
    assert.equal(jobs[1].taskId,three.runId,'high priority task starts before low priority');
    assert.ok(jobs[1].prompt.includes('First answer'),'queued task sees latest chat history');
    runner.emit('job:result',{jobId:jobs[1].jobId,ok:true,text:'Second answer'});
    await waitFor(()=>jobs.length===3);
    assert.equal(jobs[2].taskId,two.runId);
    runner.emit('job:result',{jobId:jobs[2].jobId,ok:true,text:'Third answer'});
    await waitFor(async()=> (await api('/tasks')).find(t=>t.id===two.runId).state==='completed');
    const summary=await api('/usage-summary');
    assert.equal(summary.totalTokens,123,'snapshots and saved chat history do not double count');
    assert.deepEqual(summary.byModel,[{id:'default',tokens:123}]);
    const registration=await fetch(base+'/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'queue_friend',password:'queue-friend-password'})});
    assert.equal(registration.status,201);
    const friendCookie=registration.headers.get('set-cookie').split(';')[0];
    const privateTasks=await fetch(base+'/api/tasks',{headers:{cookie:friendCookie}});
    assert.deepEqual(await privateTasks.json(),[]);
    const denied=await fetch(base+'/api/tasks/'+one.runId,{method:'DELETE',headers:{cookie:friendCookie}});
    assert.equal(denied.status,404);
    const privateUsage=await fetch(base+'/api/usage-summary',{headers:{cookie:friendCookie}});
    assert.equal((await privateUsage.json()).totalTokens,0);
    runner.disconnect();
    await waitFor(async()=> (await api('/accounts'))[0].mode==='offline');
    const offline=await submit('Wait for reconnection');
    assert.equal(offline.ok,true);
    await waitFor(async()=> (await api('/tasks')).find(t=>t.id===offline.runId).message==='Waiting for runner connection');
    await api('/tasks/'+offline.runId,'DELETE');
    assert.equal(jobs.length,3,'canceled job never ran');
  } finally {
    browser?.disconnect(); runner?.disconnect();
    const exited = new Promise(resolve => backend.once('exit', resolve));
    backend.kill('SIGTERM');
    await exited;
    await rm(root, { recursive: true, force: true });
  }
});
