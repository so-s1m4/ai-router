import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// cli.js reads RUNNER_DATA_DIR when imported, so configure an isolated writable root first.
const dataRoot = await mkdtemp(path.join(tmpdir(), 'chatgpt-runner-data-'));
const previousDataRoot = process.env.RUNNER_DATA_DIR;
process.env.RUNNER_DATA_DIR = dataRoot;
const { accountStatus, execute } = await import('../dist/cli.js');
const { saveChatGPTSession, readChatGPTSession, parseChatGPTModels } = await import('../dist/chatgpt-web.js');

after(async () => {
  if (previousDataRoot === undefined) delete process.env.RUNNER_DATA_DIR;
  else process.env.RUNNER_DATA_DIR = previousDataRoot;
  await rm(dataRoot, { recursive: true, force: true });
});

test('ChatGPT mock status reports demo mode instead of pretending to load models', async () => {
  const previous = process.env.MOCK_MODE;
  process.env.MOCK_MODE = 'true';
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-test-'));
  try {
    const controller = new AbortController();
    await assert.rejects(accountStatus('chatgpt', dir, controller.signal), error =>
      error.code === 'unavailable' && error.message.includes('MOCK_MODE=true'));
  } finally {
    if (previous === undefined) delete process.env.MOCK_MODE; else process.env.MOCK_MODE = previous;
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
  const previousChrome = process.env.CHROME_BIN;
  process.env.MOCK_MODE = 'false';
  process.env.CHROME_BIN = path.join(dataRoot, 'missing-chromium');
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
    if (previousChrome === undefined) delete process.env.CHROME_BIN;
    else process.env.CHROME_BIN = previousChrome;
  }
});

 test('session catalog filters unavailable and malformed models without static fallback', () => {
   assert.deepEqual(parseChatGPTModels({models:[
     {slug:'session-model',title:'Session model'},
     {slug:'session-model',title:'Session model'},
     {slug:'disabled',title:'Disabled',enabled:false},
     {slug:'broken'}, null
   ]}).map(m=>m.id), ['default','session-model']);
   for (const payload of [null, {}, {models:[]}, {models:[{slug:'x',title:'X',disabled:true}]}]) {
     assert.throws(()=>parseChatGPTModels(payload), {code:'unavailable'});
   }
 });
