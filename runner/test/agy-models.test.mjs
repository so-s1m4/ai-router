import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgyModels } from '../dist/agy-models.js';

test('parseAgyModels parses models and reasoning efforts from agy models output', () => {
  const output = `
gemini-3.8-flash-high     Gemini 3.8 Flash (High)
gemini-3.8-flash-medium   Gemini 3.8 Flash (Medium)
gemini-3.8-flash-low      Gemini 3.8 Flash (Low)
gemini-3.7-flash-high     Gemini 3.7 Flash (High)
gemini-3.1-pro-high       Gemini 3.1 Pro (High)
gemini-3.1-pro-low        Gemini 3.1 Pro (Low)
claude-sonnet-4-6         Claude Sonnet 4.6 (Thinking)
gpt-oss-120b-medium       GPT-OSS 120B (Medium)
`;
  const models = parseAgyModels(output);
  const flash38 = models.find(m => m.id === 'gemini-3.8-flash');
  assert.ok(flash38);
  assert.equal(flash38.label, 'Gemini 3.8 Flash');
  assert.equal(flash38.defaultReasoning, 'high');
  assert.equal(flash38.reasoning?.length, 3);
  assert.deepEqual(flash38.reasoning?.map(r => r.id), ['high', 'medium', 'low']);

  const pro31 = models.find(m => m.id === 'gemini-3.1-pro');
  assert.ok(pro31);
  assert.deepEqual(pro31.reasoning?.map(r => r.id), ['high', 'low']);

  const claude = models.find(m => m.id === 'claude-sonnet-4-6');
  assert.ok(claude);
  assert.equal(claude.reasoning, undefined);

  const gptOss = models.find(m => m.id === 'gpt-oss-120b-medium');
  assert.ok(gptOss);
});

test('parseAgyModels parses real CLI output with tabs and spinner', () => {
  const output = `⠋ Fetching available models...\r⠙ Fetching available models...\rgemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n`;
  const models = parseAgyModels(output);
  assert.equal(models.length, 2);
  const flash = models.find(m => m.id === 'gemini-3.8-flash');
  assert.ok(flash);
  assert.equal(flash.label, 'Gemini 3.8 Flash');
  assert.deepEqual(flash.reasoning?.map(r => r.id), ['high', 'low']);
  const opus = models.find(m => m.id === 'claude-opus-4-6-thinking');
  assert.ok(opus);
});
