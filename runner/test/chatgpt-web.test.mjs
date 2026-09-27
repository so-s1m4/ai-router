import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const runnerDataDir = await mkdtemp(path.join(tmpdir(), 'chatgpt-runner-'));
const previousChromeBin = process.env.CHROME_BIN;
process.env.RUNNER_DATA_DIR = runnerDataDir;
process.env.CHROME_BIN = path.join(runnerDataDir, 'missing-chromium');
after(async () => {
  if (previousChromeBin === undefined) delete process.env.CHROME_BIN;
  else process.env.CHROME_BIN = previousChromeBin;
  await rm(runnerDataDir, { recursive: true, force: true });
});

const { accountStatus, execute } = await import('../dist/cli.js');
const { saveChatGPTSession, readChatGPTSession } = await import('../dist/chatgpt-web.js');

test('ChatGPT Web returns default models in accountStatus', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-test-'));
  try {
    const controller = new AbortController();
    const status = await accountStatus('chatgpt', dir, controller.signal);
    assert.ok(status.models.some(m => m.id === 'default'));
    assert.ok(status.models.some(m => m.id === 'gpt-4o'));
    assert.ok(status.models.some(m => m.id === 'o1'));
    assert.ok(status.models.some(m => m.id === 'o3-mini'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveChatGPTSession and readChatGPTSession manage session data', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-test-'));
  try {
    await saveChatGPTSession(dir, {
      sessionToken: 'test-token-12345',
      cookies: [{ name: 'test_cookie', value: 'value_1' }]
    });

    const session = await readChatGPTSession(dir);
    assert.equal(session?.sessionToken, 'test-token-12345');
    assert.equal(session?.cookies?.[0]?.name, 'test_cookie');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ChatGPT Web execution in mock mode returns demo response with streaming deltas', async () => {
  const previous = process.env.MOCK_MODE;
  process.env.MOCK_MODE = 'true';
  try {
    const deltas = [];
    const events = [];
    const controller = new AbortController();

    const job = {
      jobId: '00000000-0000-0000-0000-000000000001',
      taskId: '00000000-0000-0000-0000-000000000002',
      accountId: 'test-account',
      provider: 'chatgpt',
      sessionId: '00000000-0000-0000-0000-000000000003',
      prompt: 'Hello ChatGPT',
      model: 'gpt-4o',
      mode: 'chat'
    };

    const text = await execute(job, controller.signal, (e) => {
      events.push(e);
      if (e.type === 'delta') deltas.push(e.text);
    });

    assert.ok(text.includes('ChatGPT Web'));
    assert.ok(text.includes('Hello ChatGPT'));
    assert.ok(deltas.length > 0);
    assert.equal(deltas.join(''), text);
    assert.ok(events.some(e => e.type === 'status'));
  } finally {
    process.env.MOCK_MODE = previous;
  }
});

test('ChatGPT Web execution when MOCK_MODE=false throws unavailable when Chromium missing', async () => {
  const previous = process.env.MOCK_MODE;
  process.env.MOCK_MODE = 'false';
  try {
    const controller = new AbortController();
    const job = {
      jobId: '00000000-0000-0000-0000-000000000001',
      taskId: '00000000-0000-0000-0000-000000000002',
      accountId: 'test-account',
      provider: 'chatgpt',
      sessionId: '00000000-0000-0000-0000-000000000003',
      prompt: 'Hello ChatGPT',
      model: 'gpt-4o',
      mode: 'chat'
    };

    await assert.rejects(
      () => execute(job, controller.signal, () => {}),
      { code: 'unavailable' }
    );
  } finally {
    process.env.MOCK_MODE = previous;
  }
});
