import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForGcpReady, GcpCommandError } from '../dist/ccc-gcp-ready.js';
test('readiness waits for SSH and package installation before allowing execution', async () => {
  let probes=0;
  await waitForGcpReady(async () => {
    if (++probes===1) throw new GcpCommandError(255,'failed to connect to backend');
    if (probes===2) throw new GcpCommandError(1,'instance is not running yet');
    if (probes===3) throw new GcpCommandError(75,'node library is still being installed');
  },new AbortController().signal,1000,1);
  assert.equal(probes,4);
});
test('readiness does not retry denied access or solver failures',async()=>{
  for(const code of [1,127,255]){
    let probes=0;
    await assert.rejects(waitForGcpReady(async()=>{probes++;throw new GcpCommandError(code,'Permission denied');},new AbortController().signal,1000,1),/Permission denied/);
    assert.equal(probes,1);
  }
});
test('readiness is bounded and respects cancellation',async()=>{
  const unavailable=async()=>{throw new GcpCommandError(75,'not ready');};
  await assert.rejects(waitForGcpReady(unavailable,new AbortController().signal,20,1),/VM is not ready/);
  const cancel=new AbortController();
  const pending=waitForGcpReady(unavailable,cancel.signal,1000,100);
  cancel.abort(new Error('Stopped by user'));
  await assert.rejects(pending,/Stopped by user/);
});
