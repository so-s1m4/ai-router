import assert from 'node:assert/strict';
import test from 'node:test';
import { modelCatalog, resolveAccountModels } from './types.js';

test('modelCatalog contains default models for codex and antigravity/gemini', () => {
  assert.ok(modelCatalog.codex.some(m => m.id === 'default'));
  assert.ok(modelCatalog.codex.some(m => m.id === 'gpt-4o'));
  assert.ok(modelCatalog.codex.some(m => m.id === 'o3'));
  assert.ok(modelCatalog.antigravity.some(m => m.id === 'default'));
  assert.ok(modelCatalog.antigravity.some(m => m.id === 'gemini-3.8-flash'));
  assert.ok(modelCatalog.antigravity.some(m => m.id === 'gemini-2.5-pro'));
  assert.ok(modelCatalog.antigravity.some(m => m.id === 'gemini-2.5-flash'));
});

test('reasoning efforts are configured for models with reasoning support', () => {
  const flash38 = modelCatalog.antigravity.find(m => m.id === 'gemini-3.8-flash');
  assert.ok(flash38?.reasoning?.length);
  assert.ok(flash38.reasoning.some(r => r.id === 'high'));
  assert.ok(flash38.reasoning.some(r => r.id === 'low'));

  const geminiPro = modelCatalog.antigravity.find(m => m.id === 'gemini-2.5-pro');
  assert.ok(geminiPro?.reasoning?.length);
  assert.ok(geminiPro.reasoning.some(r => r.id === 'high'));

  const o3 = modelCatalog.codex.find(m => m.id === 'o3');
  assert.ok(o3?.reasoning?.length);
  assert.ok(o3.reasoning.some(r => r.id === 'high'));
});

test('resolveAccountModels merges catalog with account-specific models', () => {
  const codexModels = resolveAccountModels('codex');
  assert.ok(codexModels.some(m => m.id === 'gpt-5'));

  const custom = [{ id: 'custom-model', label: 'Custom Model' }];
  const merged = resolveAccountModels('codex', custom);
  assert.ok(merged.some(m => m.id === 'custom-model'));
  assert.ok(merged.some(m => m.id === 'gpt-4o'));

  const geminiModels = resolveAccountModels('antigravity');
  assert.ok(geminiModels.some(m => m.id === 'gemini-3.8-flash'));
  assert.ok(geminiModels.some(m => m.id === 'gemini-2.5-pro'));
});
