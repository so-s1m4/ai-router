import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { FeedbackService } from './feedback.service';
import { Account, ProviderId } from './models';

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly http = inject(ApiService);
  private readonly feedback = inject(FeedbackService);
  readonly error = this.feedback.error;
  readonly notice = this.feedback.notice;
  readonly now = this.feedback.now;
  accounts = signal<Account[]>([]);
  accountName = '';
  accountProvider: ProviderId | 'openai-api' = 'codex';
  apiKeyDrafts: Record<string, string> = {};
  savingApiKey = signal('');
  deletingAccount = signal('');
  addingAccount = signal(false);
  selectedRunner = '';
  accountAvailable(a: Account) {
    return (
      a.mode === 'runner' &&
      !a.limit.cooldownUntil &&
      ![a.limit.primary, a.limit.secondary].some(
        (w) => w && w.usedPercent >= 100 && (!w.resetAt || Date.parse(w.resetAt) > this.now()),
      )
    );
  }
  async refreshAccounts() {
    this.accounts.set(await this.http.request<Account[]>('/accounts'));
  }
  async addAccount() {
    if (this.addingAccount()) return;
    this.error.set('');
    this.addingAccount.set(true);
    try {
      const isOpenAI = this.accountProvider === 'openai-api';
      const isApi = isOpenAI || ['openrouter','cerebras'].includes(this.accountProvider);
      await this.http.request('/accounts', {
        method: 'POST',
        body: JSON.stringify({
          provider: isOpenAI ? 'codex' : this.accountProvider,
          name: this.accountName,
          runnerId: this.selectedRunner,
          ...(isApi ? { authType: 'api_key' } : {}),
        }),
      });
      this.accountName = '';
      await this.refreshAccounts();
      this.notice.set(
        isApi
          ? 'The connection has been created. Open its settings to enter the API key.'
          : 'Account added. Run the login command on your container.',
      );
      return true;
    } catch (e) {
      this.error.set((e as Error).message);
      return false;
    } finally {
      this.addingAccount.set(false);
    }
  }
  async saveOpenAIKey(a: Account) {
    if (this.savingApiKey()) return;
    const apiKey = (this.apiKeyDrafts[a.id] || '').trim();
    if (!apiKey) return;
    this.savingApiKey.set(a.id);
    this.error.set('');
    try {
      await this.http.request('/accounts/' + a.id + '/api-key', {
        method: 'PUT',
        body: JSON.stringify({ apiKey }),
      });
      this.apiKeyDrafts[a.id] = '';
      await this.refreshAccounts();
      this.notice.set(
        'The API key has been saved. Models will appear after the status update.',
      );
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.savingApiKey.set('');
    }
  }
  async assignAccount(a: Account, runnerId: string) {
    try {
      await this.http.request('/accounts/' + a.id, {
        method: 'PATCH',
        body: JSON.stringify({ runnerId }),
      });
      await this.refreshAccounts();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  async setAccountPriority(a: Account, value: string) {
    const priority = Number(value);
    if (priority !== 0 && priority !== 1 && priority !== 2) return;
    try {
      await this.http.request('/accounts/' + a.id + '/priority', {
        method: 'PATCH',
        body: JSON.stringify({ priority }),
      });
      await this.refreshAccounts();
      this.notice.set('Account priority preserved');
    } catch (e) {
      this.error.set((e as Error).message);
      await this.refreshAccounts();
    }
  }
  async removeAccount(a: Account) {
    if (
      this.deletingAccount() ||
      !window.confirm(
        `Delete connection “${a.name}”? Login data and the API key on the runner will be deleted.`,
      )
    )
      return;
    this.deletingAccount.set(a.id);
    this.error.set('');
    try {
      await this.http.request('/accounts/' + encodeURIComponent(a.id), { method: 'DELETE' });
      delete this.apiKeyDrafts[a.id];
      await this.refreshAccounts();
      this.notice.set('Connection deleted');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.deletingAccount.set('');
    }
  }
  resettingAccount = signal('');
  resetAttempts = new Map<string, string>();
  async useAccountReset(a: Account) {
    if (
      this.resettingAccount() ||
      a.shared ||
      a.mode !== 'runner' ||
      !a.limit.resetCredits?.availableCount
    )
      return;
    if (!window.confirm('Use one reset for ' + a.name + ' to restore the Codex usage limits?'))
      return;
    this.resettingAccount.set(a.id);
    this.error.set('');
    try {
      const storageKey = 'account-reset-attempt:' + a.id;
      const key =
        this.resetAttempts.get(a.id) || sessionStorage.getItem(storageKey) || crypto.randomUUID();
      this.resetAttempts.set(a.id, key);
      sessionStorage.setItem(storageKey, key);
      const result = await this.http.request<{ outcome: string }>(
        '/accounts/' + encodeURIComponent(a.id) + '/reset',
        { method: 'POST', body: JSON.stringify({ idempotencyKey: key }) },
      );
      this.resetAttempts.delete(a.id);
      sessionStorage.removeItem(storageKey);
      const messages: Record<string, string> = {
        reset: 'Reset applied. Account limits are refreshing.',
        nothingToReset: 'The account limits do not need a reset.',
        noCredit: 'No resets available. Account status is refreshing.',
        alreadyRedeemed: 'This reset attempt was already applied. Account status is refreshing.',
      };
      this.notice.set(messages[result.outcome] || 'Account status is refreshing.');
      await this.refreshAccounts();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.resettingAccount.set('');
    }
  }
  resetExpiry(expiresAt: string | null) {
    if (expiresAt === null) return 'No expiry';
    const date = new Date(expiresAt);
    if (!Number.isFinite(date.getTime())) return 'Expiry unavailable';
    return (
      (date.getTime() <= this.now() ? 'Expired ' : 'Expires ') +
      new Intl.DateTimeFormat('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
    );
  }
  accountCardTheme(a: Account): string {
    if (a.authType === 'api_key') return 'theme-apikey';
    if (a.provider === 'codex') return 'theme-codex';
    if (a.provider === 'antigravity') return 'theme-gemini';
    if (a.provider === 'chatgpt') return 'theme-chatgpt';
    return '';
  }
  accountStatusBadge(a: Account): { label: string; class: string } {
    if (a.mode === 'unassigned') return { label: 'Unassigned', class: 'badge-unassigned' };
    if (a.mode === 'offline') return { label: 'Offline', class: 'badge-offline' };
    if (this.accountAvailable(a)) return { label: 'Active', class: 'badge-ready' };
    return { label: 'Quota limit', class: 'badge-limited' };
  }
}
