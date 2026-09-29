import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTokenUsage, sumTokenUsage } from './token-usage.js';

test('Codex exec totals include cached input exactly once', () => {
  assert.deepEqual(normalizeTokenUsage({ input_tokens: 190000, cached_input_tokens: 180000, output_tokens: 10000 }), {
    totalTokens: 200000, inputTokens: 190000, outputTokens: 10000, cachedInputTokens: 180000
  });
});

test('App Server and Gemini totals preserve provider-reported usage', () => {
  assert.deepEqual(normalizeTokenUsage({ totalTokens: 200000, inputTokens: 190000, outputTokens: 10000, reasoningOutputTokens: 8000 }), {
    totalTokens: 200000, inputTokens: 190000, outputTokens: 10000, reasoningOutputTokens: 8000
  });
  assert.deepEqual(normalizeTokenUsage({ promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 140 }), {
    totalTokens: 140, inputTokens: 100, outputTokens: 20
  });
});

test('missing or invalid token usage is not presented as zero', () => {
  for (const data of [undefined, {}, { limits: { primary: { usedPercent: 90 } } }, { total_tokens: -1 }, { totalTokens: NaN }, { totalTokens: '200000' }, { input_tokens: 100 }, { totalTokens: Infinity }, { totalTokens: 0.5 }]) {
    assert.equal(normalizeTokenUsage(data), undefined);
  }
  assert.deepEqual(normalizeTokenUsage({ totalTokens: 0 }), { totalTokens: 0 });
  assert.equal(sumTokenUsage([]), undefined);
});

test('handoff combines usage across accounts without inventing missing details', () => {
  assert.deepEqual(sumTokenUsage([
    { totalTokens: 120000, inputTokens: 100000, outputTokens: 20000, cachedInputTokens: 80000 },
    { totalTokens: 80000, inputTokens: 70000, outputTokens: 10000 }
  ]), { totalTokens: 200000, inputTokens: 170000, outputTokens: 30000 });
});
