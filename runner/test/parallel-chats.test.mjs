import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { Server } = createRequire(new URL('../../backend/package.json', import.meta.url))('socket.io');

test('runner starts different chats concurrently and cancels only the selected job', { timeout: 15000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'parallel-chats-'));
  const http = createServer(), io = new Server(http);
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  await writeFile(path.join(root, 'device.json'), JSON.stringify({id: randomUUID(), secret:'test', name:'test'}));
  const connected = new Promise(resolve => io.of('/runner').once('connection', resolve));
  const runner = spawn(process.execPath, [new URL('../dist/main.js', import.meta.url).pathname], {
    env: {...process.env, RUNNER_DATA_DIR:root, ROUTER_SERVER_URL:`http://127.0.0.1:${http.address().port}`, ROUTER_ALLOW_INSECURE:'true', MOCK_MODE:'true', CLI_AUTO_UPDATE:'false', CODEX_BIN:path.join(root,'missing-codex')}, stdio:'ignore',
  });
  try {
    const socket = await connected, results = new Map(), events = [];
    socket.on('job:result', result => results.set(result.jobId, result));
    socket.on('job:event', event => events.push(event));
    const job = sessionId => ({jobId:randomUUID(), taskId:randomUUID(), sessionId, accountId:randomUUID(), provider:'codex', model:'default', prompt:'Work on this chat '.repeat(25), mode:'task'});
    const first = job(randomUUID()), second = job(randomUUID());
    const start = value => socket.timeout(3000).emitWithAck('job:start', value);
    const accepted = await Promise.all([start(first), start(second)]);
    assert.ok(accepted.every(result => result.ok));
    assert.equal(results.size,0,'both starts were acknowledged before either completed');
    assert.equal((await start(job(first.sessionId))).ok,false,'the same chat stays serialized');
    assert.equal((await start(first)).ok,false,'duplicate job is rejected');
    socket.emit('job:cancel',{jobId:first.jobId});
    const deadline=Date.now()+5000;
    while(results.size<2 && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(results.get(first.jobId)?.ok,false);
    assert.equal(results.get(second.jobId)?.ok,true);
    assert.ok(events.some(e=>e.jobId===second.jobId && e.type==='delta'));
    assert.equal(events.some(e=>e.jobId===second.jobId && e.text?.includes(first.sessionId)),false);
    const next=job(first.sessionId);
    assert.equal((await start(next)).ok,true,'a stopped chat can start again');
    socket.emit('job:cancel',{jobId:next.jobId});
  } finally {
    const exited=new Promise(resolve=>runner.once('exit',resolve));runner.kill();await exited;
    await new Promise(resolve=>io.close(resolve));await rm(root,{recursive:true,force:true});
  }
});
