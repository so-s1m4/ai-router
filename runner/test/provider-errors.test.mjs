import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAuthError, isQuotaError } from '../dist/provider-errors.js';

test('workspace credit exhaustion triggers account handoff', () => {
  assert.equal(isQuotaError('Your workspace is out of credits. Ask your workspace owner to refill in order to continue.'), true);
  assert.equal(isQuotaError('usage limit reached'), true);
  assert.equal(isQuotaError('Authentication failed'), false);
});

test('missing bearer and HTTP authorization failures are not solver failures', () => {
  for (const message of ['unexpected status 401 Unauthorized: Missing bearer or basic authentication in header', 'HTTP 403 Forbidden', 'Authentication failed', 'Codex login required']) assert.equal(isAuthError(message), true);
  for (const message of ['solver.json missing', 'compile failed', 'usage limit reached']) assert.equal(isAuthError(message), false);
});
