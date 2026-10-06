import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendSchema } from './run-input.js';

const base = { sessionId: '123e4567-e89b-42d3-a456-426614174000', prompt: 'https://codingcontest.org/contests/training-example/game', model: 'auto' };
test('CCC mode pins provider, model, medium reasoning and Fast before queue persistence', () => {
  const input = sendSchema.parse({ ...base, workflow: 'ccc-auto', service: 'gemini', model: 'other-model', reasoning: 'high', fast: false, mode: 'chat' });
  assert.equal(input.service, 'codex');
  assert.equal(input.model, 'gpt-6.1-sol');
  assert.equal(input.reasoning, 'medium');
  assert.equal(input.fast, true);
  assert.equal(input.mode, 'task');
  assert.deepEqual(sendSchema.parse(input), input);
});
test('existing requests preserve model/provider selections and reject unknown workflows', () => {
  const input = sendSchema.parse({ ...base, service: 'gemini', model: 'gemini-model', reasoning: 'high' });
  assert.equal(input.workflow, 'standard');
  assert.equal(input.model, 'gemini-model');
  assert.equal(input.service, 'gemini');
  assert.equal(input.reasoning, 'high');
  assert.equal(input.fast, false);
  assert.equal(sendSchema.safeParse({ ...base, workflow: 'unknown' }).success, false);
});

test('Cerebras service and shared account IDs are accepted',()=>{
  const input=sendSchema.parse({...base,service:'cerebras',model:'gpt-oss-120b',reasoning:'medium'});
  assert.equal(input.service,'cerebras');
  assert.equal(input.reasoning,'medium');
  assert.equal(sendSchema.parse({...base,accountId:base.sessionId+':cerebras'}).accountId,base.sessionId+':cerebras');
});
