import { Injectable, computed, inject, signal } from '@angular/core';
import { AccountsService } from './accounts.service';
import { ApiService } from './api.service';
import { FeedbackService } from './feedback.service';
import { AccessGrant } from './models';
@Injectable({ providedIn: 'root' })
export class SharedAccessService {
  private readonly accountService = inject(AccountsService);
  readonly accounts = this.accountService.accounts;
  refreshAccounts() {
    return this.accountService.refreshAccounts();
  }
  private readonly http = inject(ApiService);
  private readonly feedback = inject(FeedbackService);
  readonly error = this.feedback.error;
  readonly notice = this.feedback.notice;
  grants = signal<AccessGrant[]>([]);
  grantBusy = signal(false);
  grantEditor = signal(false);
  grantId = '';
  grantUsername = '';
  grantBudget = 1000000;
  grantPeriod: 'once' | 'monthly' = 'monthly';
  grantModels: string[] = [];
  ownAccounts = computed(() => this.accounts().filter((a) => !a.shared));
  grantAvailableModels() {
    return [
      ...new Map(
        this.ownAccounts()
          .flatMap((a) => a.models)
          .map((m) => [m.id, m]),
      ).values(),
    ];
  }
  toggleGrantModel(id: string) {
    this.grantModels = this.grantModels.includes(id)
      ? this.grantModels.filter((m) => m !== id)
      : [...this.grantModels, id];
  }
  openGrantEditor(g?: AccessGrant) {
    this.grantId = g?.id || '';
    this.grantUsername = g?.recipientName || '';
    this.grantBudget = g?.budget || 1000000;
    this.grantPeriod = g?.period || 'monthly';
    this.grantModels = g
      ? [...g.models]
      : this.grantAvailableModels()
          .filter((m) => m.id !== 'default')
          .map((m) => m.id);
    this.grantEditor.set(true);
  }
  async refreshGrants() {
    try {
      this.grants.set(await this.http.request<AccessGrant[]>('/access-grants'));
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  async saveGrant() {
    if (this.grantBusy()) return;
    this.grantBusy.set(true);
    this.error.set('');
    try {
      const body = this.grantId
        ? { budget: this.grantBudget, models: this.grantModels }
        : {
            username: this.grantUsername,
            budget: this.grantBudget,
            models: this.grantModels,
            period: this.grantPeriod,
          };
      await this.http.request('/access-grants' + (this.grantId ? '/' + this.grantId : ''), {
        method: this.grantId ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      this.grantEditor.set(false);
      await this.refreshGrants();
      await this.refreshAccounts();
      this.notice.set(
        this.grantId
          ? 'Access settings saved'
          : 'The invitation has been sent. A friend can accept it in connections.',
      );
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.grantBusy.set(false);
    }
  }
  async setGrantState(g: AccessGrant, state: 'active' | 'revoked') {
    if (this.grantBusy()) return;
    this.grantBusy.set(true);
    try {
      await this.http.request('/access-grants/' + g.id, {
        method: 'PATCH',
        body: JSON.stringify({ state }),
      });
      await this.refreshGrants();
      await this.refreshAccounts();
      this.notice.set(
        state === 'active'
          ? 'Access accepted - models available in chat'
          : 'Access revoked, current task stopped',
      );
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.grantBusy.set(false);
    }
  }
  grantUsage(g: AccessGrant) {
    return Object.entries(g.usageByModel).map(([model, tokens]) => ({ model, tokens }));
  }
}
