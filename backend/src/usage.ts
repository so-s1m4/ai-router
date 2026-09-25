export type UsageWindow = {
  usedPercent: number;
  remainingPercent: number;
  windowMinutes: number | null;
  resetAt: string | null;
};

export type ProviderUsage = {
  source: 'provider' | 'unknown';
  primary: UsageWindow | null;
  secondary: UsageWindow | null;
  cooldownUntil: string | null;
  updatedAt: string | null;
};

type UsageInputWindow = Partial<UsageWindow> & { usedPercent?: number };
type UsageInput = {
  primary?: UsageInputWindow | null;
  secondary?: UsageInputWindow | null;
};

/**
 * Stores only provider-reported usage windows and a short local cooldown after
 * a provider rate-limit response. It deliberately does not count requests:
 * the provider account is the source of truth for quota.
 */
export class AccountUsageManager {
  private records = new Map<string, ProviderUsage>();
  constructor(private cooldownMs = Number(process.env.RATE_LIMIT_COOLDOWN_SECONDS || 300) * 1000) {}

  private key(user: string, account: string) { return `${user}:${account}`; }

  snapshot(user: string, account: string): ProviderUsage {
    const value = this.records.get(this.key(user, account));
    if (!value) return {source: 'unknown', primary: null, secondary: null, cooldownUntil: null, updatedAt: null};
    if (value.cooldownUntil && Date.parse(value.cooldownUntil) <= Date.now()) value.cooldownUntil = null;
    return value;
  }

  available(user: string, account: string) { return !this.snapshot(user, account).cooldownUntil; }

  update(user: string, account: string, input: UsageInput) {
    const old = this.snapshot(user, account);
    const mapWindow = (window: UsageInputWindow | null | undefined, previous: UsageWindow | null): UsageWindow | null => {
      if (!window) return previous;
      const used = Number(window.usedPercent);
      if (!Number.isFinite(used)) return previous;
      const bounded = Math.min(100, Math.max(0, used));
      return {
        usedPercent: bounded,
        remainingPercent: Math.max(0, 100 - bounded),
        windowMinutes: Number.isFinite(Number(window.windowMinutes)) ? Number(window.windowMinutes) : previous?.windowMinutes ?? null,
        resetAt: typeof window.resetAt === 'string' ? window.resetAt : previous?.resetAt ?? null
      };
    };
    const record: ProviderUsage = {
      source: 'provider',
      primary: mapWindow(input.primary, old.primary),
      secondary: mapWindow(input.secondary, old.secondary),
      cooldownUntil: old.cooldownUntil,
      updatedAt: new Date().toISOString()
    };
    this.records.set(this.key(user, account), record);
  }

  rateLimited(user: string, account: string) {
    const current = this.snapshot(user, account);
    current.cooldownUntil = new Date(Date.now() + this.cooldownMs).toISOString();
    this.records.set(this.key(user, account), current);
  }
}
