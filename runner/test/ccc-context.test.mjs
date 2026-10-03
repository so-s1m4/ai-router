import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundedText, compactFeedback, codeContext } from '../dist/ccc-context.js';

test('bounded diagnostics keep both ends and explicitly mark missing content', () => {
  const result = boundedText('START' + 'x'.repeat(40000) + 'END', 1000);
  assert.ok(result.length <= 1000);
  assert.ok(result.startsWith('START'));
  assert.ok(result.endsWith('END'));
  assert.match(result, /truncated/);
});

test('feedback retains verdict and complete source, with bounded verbose case details', () => {
  const source = 'solver'.repeat(20000);
  const result = compactFeedback({ source, evaluations: { a: { cases: Array.from({length: 1000}, () => ({expected:'x'.repeat(10000)})), isCorrect: false } } });
  assert.equal(result.source, source);
  assert.equal(result.evaluations.a.isCorrect, false);
  assert.ok(JSON.stringify({...result,source:undefined}).length < 18000);
  assert.match(JSON.stringify(result.evaluations), /truncated/);
});

test('code context transmits identical source only once without mutating context', () => {
  const source = 'int main(){return 0;}';
  const context = {source,currentLightSource:source,previousLevel:{source},evaluationFeedback:{source,evaluations:{isCorrect:false}}};
  const result = JSON.parse(codeContext(context));
  assert.equal(result.source,source);
  assert.deepEqual(result.currentLightSource,{sameAs:'source'});
  assert.deepEqual(result.previousLevel.source,{sameAs:'source'});
  assert.deepEqual(result.evaluationFeedback.source,{sameAs:'source'});
  assert.equal(context.previousLevel.source,source);
});
