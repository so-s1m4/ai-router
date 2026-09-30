import { TestBed } from '@angular/core/testing';
import { AccountsService } from './accounts.service';
import { ApiService } from './api.service';
import { Account } from './models';

const account: Account = {
  id: 'reset-test',
  provider: 'codex',
  name: 'Test',
  models: [],
  mode: 'runner',
  auth: 'ready',
  detail: '',
  limit: {
    source: 'provider',
    primary: null,
    secondary: null,
    cooldownUntil: null,
    updatedAt: null,
    resetCredits: { availableCount: 1, credits: [] },
  },
};
describe('Account reset service', () => {
  let accounts: AccountsService;
  let api: jasmine.Spy;
  beforeEach(() => {
    accounts = TestBed.inject(AccountsService);
    api = spyOn(TestBed.inject(ApiService), 'request');
    spyOn(window, 'confirm').and.returnValue(true);
    sessionStorage.removeItem('account-reset-attempt:reset-test');
  });
  afterEach(() => sessionStorage.removeItem('account-reset-attempt:reset-test'));

  it('retains the idempotency key after a lost response and reuses it after reload', async () => {
    api.and.rejectWith(new Error('Connection lost'));
    await accounts.useAccountReset(account);
    const firstKey = JSON.parse(api.calls.mostRecent().args[1].body).idempotencyKey;
    expect(sessionStorage.getItem('account-reset-attempt:reset-test')).toBe(firstKey);
    accounts.resetAttempts.clear();
    api.and.resolveTo({ outcome: 'alreadyRedeemed' });
    spyOn(accounts, 'refreshAccounts').and.resolveTo();
    await accounts.useAccountReset(account);
    expect(JSON.parse(api.calls.mostRecent().args[1].body).idempotencyKey).toBe(firstKey);
    expect(sessionStorage.getItem('account-reset-attempt:reset-test')).toBeNull();
    expect(accounts.resettingAccount()).toBe('');
  });

  it('prevents overlapping reset requests', async () => {
    let complete!: (value: { outcome: string }) => void;
    api.and.returnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    spyOn(accounts, 'refreshAccounts').and.resolveTo();
    const pending = accounts.useAccountReset(account);
    await accounts.useAccountReset(account);
    expect(api).toHaveBeenCalledTimes(1);
    complete({ outcome: 'reset' });
    await pending;
    expect(accounts.resettingAccount()).toBe('');
  });

  it('does not redeem resets for shared or offline accounts', async () => {
    await accounts.useAccountReset({ ...account, shared: true });
    await accounts.useAccountReset({ ...account, mode: 'offline' });
    expect(api).not.toHaveBeenCalled();
  });
});
