import assert from 'node:assert/strict';
import { createHmac, pbkdf2Sync } from 'node:crypto';
import test from 'node:test';
import { ManagementPasswordGate } from '../dist/manager-auth.js';

test('management proof is bound to a single challenge, operation and payload', () => {
  const gate = new ManagementPasswordGate('a-long-local-runner-password');
  const payload = { id: 'some-container' };
  const challenge = gate.challenge();
  const key = pbkdf2Sync('a-long-local-runner-password', Buffer.from(challenge.salt, 'base64url'), challenge.iterations, 32, 'sha256');
  const proof = createHmac('sha256', key).update(JSON.stringify({ nonce: challenge.nonce, op: 'containers.stop', payload })).digest('base64url');
  assert.equal(gate.verify(challenge.nonce, proof, 'containers.start', payload), false);
  assert.equal(gate.verify(challenge.nonce, proof, 'containers.stop', payload), false);
  const next = gate.challenge();
  const valid = createHmac('sha256', key).update(JSON.stringify({ nonce: next.nonce, op: 'containers.stop', payload })).digest('base64url');
  assert.equal(gate.verify(next.nonce, valid, 'containers.stop', payload), true);
  assert.equal(gate.verify(next.nonce, valid, 'containers.stop', payload), false);
});
