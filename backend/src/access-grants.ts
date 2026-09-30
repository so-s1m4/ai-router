import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from './store.js';

export interface AccessGrant {
  id: string; ownerId: string; recipientId: string; recipientName: string; ownerName: string;
  models: string[]; budget: number;
  period: 'once' | 'monthly'; state: 'pending' | 'active' | 'revoked';
  usedTokens: number; lifetimeTokens: number; usageByModel: Record<string, number>;
  month: string; createdAt: string;
}
const file = path.join(dataRoot, 'access-grants.json');
let queue: Promise<unknown> = Promise.resolve();
const leases = new Set<string>();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const task = queue.then(operation); queue = task.catch(() => undefined); return task;
}
async function read(): Promise<AccessGrant[]> {
  try {
    // Existing grants use the owner's pool, preserving budgets and permissions.
    return JSON.parse(await readFile(file, 'utf8')).map(({ accountId, accountName, ...grant }: AccessGrant & { accountId?: string; accountName?: string }) => grant);
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
async function save(rows: AccessGrant[]) {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  await writeFile(file + '.tmp', JSON.stringify(rows, null, 2), { mode: 0o600 });
  await rename(file + '.tmp', file);
}
export function grantSnapshot(grant: AccessGrant, now = new Date()): AccessGrant {
  const month = now.toISOString().slice(0, 7);
  return grant.period === 'monthly' && grant.month !== month
    ? { ...grant, month, usedTokens: 0, usageByModel: {} } : { ...grant };
}
export function listGrants(userId: string): Promise<AccessGrant[]> {
  return serial(async () => (await read()).filter(g => g.ownerId === userId || g.recipientId === userId).map(g => grantSnapshot(g)));
}
export function createGrant(input: Omit<AccessGrant, 'id' | 'state' | 'usedTokens' | 'lifetimeTokens' | 'usageByModel' | 'month' | 'createdAt'>) {
  return serial(async () => {
    const rows = await read();
    const grant: AccessGrant = { ...input, models: [...new Set(input.models)], id: randomUUID(), state: 'pending', usedTokens: 0, lifetimeTokens: 0, usageByModel: {}, month: new Date().toISOString().slice(0, 7), createdAt: new Date().toISOString() };
    rows.push(grant); await save(rows); return grant;
  });
}
export function updateGrant(userId: string, id: string, change: { budget?: number; models?: string[]; state?: 'active' | 'revoked' }) {
  return serial(async () => {
    const rows = await read(), index = rows.findIndex(g => g.id === id);
    if (index < 0) return null;
    const grant = grantSnapshot(rows[index]);
    const accepting = change.state === 'active';
    if (accepting ? grant.recipientId !== userId || grant.state !== 'pending' || change.budget !== undefined || change.models !== undefined : grant.ownerId !== userId || grant.state === 'revoked') return null;
    Object.assign(grant, change); rows[index] = grant; await save(rows); return grant;
  });
}
export function acquireGrant(userId: string, id: string, model: string): Promise<AccessGrant | null> {
  return serial(async () => {
    const found = (await read()).find(g => g.id === id && g.recipientId === userId);
    if (!found) return null;
    const grant = grantSnapshot(found);
    if (grant.state !== 'active' || grant.usedTokens >= grant.budget || !grant.models.includes(model) || leases.has(id)) return null;
    leases.add(id); return grant;
  });
}
export function releaseGrant(id: string) { leases.delete(id); }
export function chargeGrant(id: string, model: string, tokens: number) {
  return serial(async () => {
    if (!Number.isSafeInteger(tokens) || tokens <= 0) return;
    const rows = await read(), index = rows.findIndex(g => g.id === id);
    if (index < 0) return;
    const grant = grantSnapshot(rows[index]);
    grant.usedTokens += tokens; grant.lifetimeTokens += tokens;
    grant.usageByModel[model] = (grant.usageByModel[model] || 0) + tokens;
    rows[index] = grant; await save(rows);
  });
}
export async function flushGrantCharges() { await queue; }
