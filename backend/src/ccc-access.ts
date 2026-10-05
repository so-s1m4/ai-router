import type { CccCandidate } from './ccc-settings.js';
import { acquireGrant, chargeGrant, flushGrantCharges, releaseGrant, type AccessGrant } from './access-grants.js';

export type CccAccount = { id: string; provider: string; runnerId?: string; grant?: AccessGrant };
export function cccConnectionId(account: CccAccount) {
  return account.grant ? `${account.grant.id}:${account.provider}` : account.id;
}
export function cccCandidateAccount<T extends CccAccount>(candidate: CccCandidate, accounts: T[], models: (account: T) => {id: string}[], blacklist: string[], runnerId?: string): T | undefined {
  return accounts.find(account => account.provider === candidate.provider && (!runnerId || account.runnerId === runnerId)
    && (!candidate.accountId || candidate.accountId === cccConnectionId(account))
    && !blacklist.includes(candidate.model) && models(account).some(model => model.id === candidate.model)
    && (!account.grant || (account.grant.state === 'active' && account.grant.usedTokens < account.grant.budget && account.grant.models.includes(candidate.model))));
}

// A grant is reserved once even when many candidates use its account pool.
export class CccGrantUsage {
  readonly grants = new Map<string, AccessGrant>();
  private readonly charged = new Map<string, number>();
  private readonly sources = new Map<string, string>();
  private readonly targets = new Map<string, AccessGrant>();
  constructor(private readonly userId: string, private readonly stop: (reason: string) => void) {}
  async reserve(account: CccAccount, model: string) {
    const key = `${account.id}:${account.provider}:${model}`, source = account.grant?.id ?? 'own';
    if (this.sources.has(key) && this.sources.get(key) !== source) throw new Error('CCC-Auto: use one allowance per connection/model');
    this.sources.set(key, source);
    if (!account.grant) return;
    let grant = this.grants.get(account.grant.id);
    if (!grant) {
      grant = await acquireGrant(this.userId, account.grant.id, model) ?? undefined;
      if (!grant) throw new Error('CCC-Auto: shared access busy, revoked or budget exhausted');
      this.grants.set(grant.id, grant);
    }
    if (!grant.models.includes(model)) throw new Error('CCC-Auto: shared model denied');
    this.targets.set(`${account.id}:${account.provider}:${model}`, grant);
  }
  publicAccountId(accountId: string, provider: string, model: string) {
    const grant = this.targets.get(`${accountId}:${provider}:${model}`);
    return grant ? `${grant.id}:${provider}` : accountId;
  }
  publicUsage(rows: {accountId: string; provider: string; model: string; [key: string]: unknown}[]) {
    return rows.filter(row => this.sources.has(`${row.accountId}:${row.provider}:${row.model}`))
      .map(row => ({...row, accountId: this.publicAccountId(row.accountId, row.provider, row.model)}));
  }
  record(accountId: string, provider: string, model: string, totalTokens: number) {
    const key = `${accountId}:${provider}:${model}`, grant = this.targets.get(key);
    if (!grant) return;
    const previous = this.charged.get(key) ?? 0;
    if (totalTokens <= previous) return;
    this.charged.set(key, totalTokens);
    void chargeGrant(grant.id, model, totalTokens - previous).then(current => {
      if (current && (current.state !== 'active' || current.usedTokens >= current.budget || !current.models.includes(model))) this.stop('CCC-Auto: shared access revoked, model denied or token budget exhausted');
    }).catch(error => { console.error('CCC shared usage persistence failed', error); this.stop('CCC-Auto: shared token usage could not be saved'); });
  }
  async release() {
    if (!this.grants.size) return;
    await flushGrantCharges();
    for (const id of this.grants.keys()) releaseGrant(id);
    this.grants.clear();
  }
}
