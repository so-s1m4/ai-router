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

test('personal MCP is private and is dispatched with shared tokens', {timeout:30000}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-mcp-api-'));
  const port = await freePort(), previewPort = await freePort(), base = `http://127.0.0.1:${port}`;
  const backend = spawn(process.execPath, [path.join(repo,'backend/dist/server.js')], {cwd:repo,env:{...process.env,DATA_DIR:root,PORT:String(port),PREVIEW_PORT:String(previewPort),ADMIN_PASSWORD:'personal-test-password',SESSION_SECRET:'personal-test-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false'},stdio:['ignore','ignore','ignore']});
  const sockets = [];
  try {
    await waitFor(async () => (await fetch(base+'/api/health')).ok);
    const auth = async (username, register=false) => {
      const res = await fetch(base+'/api/'+(register?'register':'login'), {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'personal-test-password'})});
      assert.ok(res.ok); return res.headers.get('set-cookie').split(';')[0];
    };
    const owner = await auth('admin'), friend = await auth('friend', true);
    const api = async (cookie, url, method='GET', body) => {
      const res = await fetch(base+'/api'+url, {method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
      return {status:res.status,body:await res.json()};
    };
    const personal = {name:'mine',url:'https://friend.example/mcp',headers:{Authorization:'Bearer private-secret'}};
    assert.equal((await api(friend,'/personal-mcp/mine','PUT',personal)).status,200);
    assert.equal(JSON.stringify((await api(friend,'/personal-mcp')).body).includes('private-secret'),false);
    assert.deepEqual((await api(owner,'/personal-mcp')).body,[]);
    for (const invalid of [{url:'http://example.com'}, {url:'https://example.com',command:'echo'}, {url:'https://example.com',headers:{Token:'a',token:'b'}}, {url:'https://example.com',headers:{Token:'x\r\nInjected: yes'}}]) {
      assert.equal((await api(friend,'/personal-mcp/bad','PUT',invalid)).status,400);
    }
    const pairing = await api(owner,'/runners/pairing','POST',{name:'Owner runner'});
    const device = await (await fetch(base+'/api/runner/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.body.code})})).json();
    const runner = await connect(base+'/runner',{auth:{runnerId:device.id,secret:device.secret}}); sockets.push(runner);
    await api(owner,'/accounts','POST',{provider:'codex',name:'Owner',runnerId:device.id});
    const grant = await api(owner,'/access-grants','POST',{username:'friend',period:'once',budget:100000,models:['default']});
    assert.equal(grant.status,201);
    assert.equal((await api(friend,'/access-grants/'+grant.body.id,'PATCH',{state:'active'})).status,200);
    const session = (await api(friend,'/sessions','POST',{})).body;
    const browser = await connect(base,{extraHeaders:{cookie:friend}}); sockets.push(browser);
    let received;
    runner.on('job:start',(job,ack) => { received=job; ack({ok:true}); runner.emit('job:result',{jobId:job.jobId,ok:true,text:'Done'}); });
    const finished = new Promise((resolve,reject) => {
      const timer = setTimeout(()=>reject(new Error('No terminal event')),5000);
      browser.on('ai:event',event => {if (event.sessionId===session.id && ['completed','error'].includes(event.type)) {clearTimeout(timer);resolve(event);}});
    });
    const result = await browser.timeout(5000).emitWithAck('run',{sessionId:session.id,prompt:'Use my MCP',model:'default',service:'codex'});
    assert.equal(result.ok,true);
    assert.equal((await finished).type,'completed');
    assert.equal(received.sharedExecution,true);
    assert.deepEqual(received.personalMcp,[personal]);
    assert.equal((await api(owner,'/personal-mcp/mine','DELETE')).status,200);
    assert.equal((await api(friend,'/personal-mcp')).body.length,1);
    assert.equal((await api(friend,'/personal-mcp/mine','DELETE')).status,200);
    assert.deepEqual((await api(friend,'/personal-mcp')).body,[]);
  } finally {
    for (const socket of sockets) socket.disconnect();
    backend.kill('SIGTERM'); await new Promise(resolve => backend.once('exit',resolve));
    await rm(root,{recursive:true,force:true});
  }
});
