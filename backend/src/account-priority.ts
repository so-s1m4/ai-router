import type { Account } from './store.js';

// Older accounts have no stored priority and retain the normal level.
export function orderAccountsByPriority<T extends Pick<Account, 'priority'>>(accounts: T[], cursor: number): T[] {
  const ordered: T[] = [];
  for (const priority of [2, 1, 0]) {
    const group = accounts.filter(account => (account.priority ?? 1) === priority);
    if (!group.length) continue;
    const offset = cursor % group.length;
    ordered.push(...group.slice(offset), ...group.slice(0, offset));
  }
  return ordered;
}
