import assert from 'node:assert/strict';
import test from 'node:test';
import { withProjectOperation } from './project-sync.js';

test('workspace operations serialize per project while other projects remain available', async () => {
  let unblock!: () => void;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const events: string[] = [];
  const first = withProjectOperation('shared', async () => {
    events.push('first');
    await blocked;
    events.push('finished');
  });
  const second = withProjectOperation('shared', async () => { events.push('second'); });
  await withProjectOperation('other', async () => { events.push('other'); });
  assert.deepEqual(events, ['first', 'other']);
  unblock();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first', 'other', 'finished', 'second']);
});

test('failed workspace operations release queued operations', async () => {
  const failed = withProjectOperation('failure', async () => { throw new Error('Sync failed'); });
  const next = withProjectOperation('failure', async () => 'uploaded');
  await assert.rejects(failed, /Sync failed/);
  assert.equal(await next, 'uploaded');
  assert.equal(await withProjectOperation('failure', async () => 'deleted'), 'deleted');
});
