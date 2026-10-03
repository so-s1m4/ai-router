import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('session can be created and updated with projectId', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-router-session-'));
  process.env.DATA_DIR = dir;
  try {
    const { createSession, getSession, saveSession, deleteSession, listSessions } = await import('./store.js');
    const user = 'test-user-session';

    const session = await createSession(user);
    assert.ok(session.id);
    assert.equal(session.projectId, undefined);

    const fetched = await getSession(user, session.id);
    assert.ok(fetched);
    assert.equal(fetched.id, session.id);

    const testProjectId = '00000000-0000-0000-0000-000000000001';
    fetched.projectId = testProjectId;
    fetched.title = 'Updated Title';
    await saveSession(user, fetched);

    const afterUpdate = await getSession(user, session.id);
    assert.ok(afterUpdate);
    assert.equal(afterUpdate.projectId, testProjectId);
    assert.equal(afterUpdate.title, 'Updated Title');

    assert.equal(await deleteSession('another-user', session.id), false);
    assert.ok(await getSession(user, session.id));
    // Serialize deletion against both in-flight and late writes from the runner.
    const pendingWrite = saveSession(user, afterUpdate);
    const deletion = deleteSession(user, session.id);
    const lateWrite = saveSession(user, afterUpdate);
    await Promise.all([pendingWrite, deletion, lateWrite]);
    assert.equal(await deletion, true);
    assert.equal(await getSession(user, session.id), null);
    assert.deepEqual(await listSessions(user), []);
    assert.equal(await deleteSession(user, session.id), false);
    await saveSession(user, afterUpdate);
    assert.equal(await getSession(user, session.id), null);

  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
test('listSessions filters empty chats and sorts by most recent message', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-router-session-list-'));
  process.env.DATA_DIR = dir;
  try {
    const { createSession, listSessions, saveSession } = await import('./store.js');
    const user = 'test-user-list';

    // 1. Create an empty session
    const s1 = await createSession(user);

    // Should return 0 sessions because s1 is empty
    let list = await listSessions(user);
    assert.equal(list.length, 0);

    // 2. Add message to s1 with earlier timestamp
    s1.messages = [
      { id: 'm1', role: 'user', text: 'Hello 1', at: '2026-09-27T10:00:00.000Z' }
    ];
    await saveSession(user, s1);

    list = await listSessions(user);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, s1.id);

    // 3. Create s2 and add message with later timestamp
    const s2 = await createSession(user);
    s2.messages = [
      { id: 'm2', role: 'user', text: 'Hello 2', at: '2026-09-27T11:00:00.000Z' }
    ];
    await saveSession(user, s2);

    list = await listSessions(user);
    assert.equal(list.length, 2);
    // s2 must be on top because its message is later (11:00 > 10:00)
    assert.equal(list[0].id, s2.id);
    assert.equal(list[1].id, s1.id);

    // 4. Send a new message in s1 at 12:00
    s1.messages.push({ id: 'm3', role: 'user', text: 'Hello 3', at: '2026-09-27T12:00:00.000Z' });
    await saveSession(user, s1);

    list = await listSessions(user);
    assert.equal(list.length, 2);
    // s1 must now be on top because 12:00 > 11:00
    assert.equal(list[0].id, s1.id);
    assert.equal(list[1].id, s2.id);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
