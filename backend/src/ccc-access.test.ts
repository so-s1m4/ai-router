import assert from 'node:assert/strict';
import test from 'node:test';
import { cccCandidateAccount } from './ccc-access.js';
import { defaultCccAutoSettings } from './ccc-settings.js';

const candidate = defaultCccAutoSettings().levels[0].candidates[0];
const accounts = [
  {id:'old',provider:'codex',runnerId:'runner',priority:0 as const},
  {id:'high-a',provider:'codex',runnerId:'runner',priority:2 as const},
  {id:'normal',provider:'codex',runnerId:'runner'},
  {id:'high-b',provider:'codex',runnerId:'runner',priority:2 as const},
];
const models = () => [{id:candidate.model}];

test('CCC auto chooses highest priority and rotates within that priority', () => {
  assert.equal(cccCandidateAccount(candidate,accounts,models,[],'runner',0)?.id,'high-a');
  assert.equal(cccCandidateAccount(candidate,accounts,models,[],'runner',1)?.id,'high-b');
  assert.equal(accounts[0].id,'old');
});

test('CCC skips unavailable models and respects explicit connections, runner and blacklist', () => {
  const availableModels = (account:typeof accounts[number]) => account.id.startsWith('high') ? [] : models();
  assert.equal(cccCandidateAccount(candidate,accounts,availableModels,[],'runner')?.id,'normal');
  assert.equal(cccCandidateAccount({...candidate,accountId:'old'},accounts,models,[],'runner')?.id,'old');
  assert.equal(cccCandidateAccount({...candidate,accountId:'high-a'},accounts,availableModels,[],'runner'),undefined);
  assert.equal(cccCandidateAccount(candidate,accounts,models,[],'other'),undefined);
  assert.equal(cccCandidateAccount(candidate,accounts,models,[candidate.model],'runner'),undefined);
  const withinQuota = accounts.filter(account=>!account.id.startsWith('high'));
  assert.equal(cccCandidateAccount(candidate,withinQuota,models,[],'runner')?.id,'normal');
});
