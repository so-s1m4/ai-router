export type ResetCredits = {
  availableCount: number;
  credits: {id: string; expiresAt: string | null; title: string | null}[] | null;
};

// Count is authoritative: detail rows can be omitted or capped by OpenAI.
export function parseResetCredits(raw: unknown): ResetCredits | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const count = value.availableCount;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null;
  const credits: NonNullable<ResetCredits['credits']> = [];
  if (Array.isArray(value.credits)) for (const row of value.credits) {
    if (!row || row.status !== 'available' || typeof row.id !== 'string') continue;
    let expiresAt: string | null = null;
    if (row.expiresAt !== null) {
      if (typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt)) continue;
      const date = new Date(row.expiresAt * 1000);
      if (!Number.isFinite(date.getTime())) continue;
      expiresAt = date.toISOString();
    }
    credits.push({id: row.id, expiresAt, title: typeof row.title === 'string' ? row.title.slice(0,160) : null});
  }
  credits.sort((a,b)=>(a.expiresAt ? Date.parse(a.expiresAt) : Infinity)-(b.expiresAt ? Date.parse(b.expiresAt) : Infinity));
  return {availableCount: count, credits: Array.isArray(value.credits) ? credits : null};
}
