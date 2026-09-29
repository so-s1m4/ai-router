import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isQuotaError } from '../dist/provider-errors.js';

test('workspace credit exhaustion triggers account handoff', () => {
  assert.equal(isQuotaError('Your workspace is out of credits. Ask your workspace owner to refill in order to continue.'), true);
  assert.equal(isQuotaError('usage limit reached'), true);
  assert.equal(isQuotaError('Authentication failed'), false);
});
