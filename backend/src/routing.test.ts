import assert from 'node:assert/strict';
import test from 'node:test';
import { modelCatalog, resolveAccountModels } from './types.js';

test('catalog only advertises the default model before runner discovery', () => {
  for (const provider of ['codex', 'antigravity', 'chatgpt'] as const) {
    assert.ok(modelCatalog[provider].some(model => model.id === 'default'));
  }
  assert.deepEqual(resolveAccountModels('chatgpt').map(model => model.id), ['default']);
});

test('runner model list replaces stale catalog entries and preserves supported reasoning', () => {
  const reported = [{ id: 'current-model', label: 'Current model', reasoning: [{ id: 'high', label: 'Высокое' }] }];
  const models = resolveAccountModels('codex', reported);
  assert.deepEqual(models.map(model => model.id), ['default', 'current-model']);
  assert.deepEqual(models[1].reasoning, reported[0].reasoning);
  assert.deepEqual(resolveAccountModels('codex', []).map(model => model.id), ['default']);
});
