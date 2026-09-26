import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgyUsage } from '../dist/agy-usage.js';

test('reads Gemini account windows from official Antigravity usage report', () => {
  const report = 'Gemini Models\tWeekly Limit Remaining\t99%\t2026-10-02T08:30:36Z\nGemini Models\tFive Hour Limit Remaining\t98%\t2026-09-26T14:04:31Z\nClaude and GPT models\tWeekly Limit Remaining\t67%\t2026-09-27T22:29:51Z\n';
  assert.deepEqual(parseAgyUsage(report), {
    primary: { usedPercent: 2, windowMinutes: 300, resetAt: '2026-09-26T14:04:31.000Z' },
    secondary: { usedPercent: 1, windowMinutes: 10080, resetAt: '2026-10-02T08:30:36.000Z' }
  });
  assert.equal(parseAgyUsage('authentication required\n'), null);
});
