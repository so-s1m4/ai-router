import { Injectable, computed, inject, signal } from '@angular/core';
import { AccountsService } from './accounts.service';
import { ApiService } from './api.service';
import { FeedbackService } from './feedback.service';
import { AccessGrant } from './models';
import { ModelsService } from './models.service';
@Injectable({ providedIn: 'root' })
export class SharedAccessService {
  private readonly accountService = inject(AccountsService);
  readonly accounts = this.accountService.accounts;
  private readonly modelService = inject(ModelsService);
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
  grantAvailableModels = computed(() => [
      ...new Map(
        this.ownAccounts()
          .flatMap((a) => a.models)
          .filter((m) => this.modelService.isModelEnabled(m.id))
          .map((m) => [m.id, m]),
      ).values(),
    ]);
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
    const available = new Set(this.grantAvailableModels().map((m) => m.id));
    this.grantModels = g
      ? g.models.filter((id) => available.has(id))
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
  selectedGrantModels() {
    const available = new Set(this.grantAvailableModels().map((m) => m.id));
    return [...new Set(this.grantModels)].filter((id) => available.has(id));
  }
  grantValidationError() {
    if (this.grantUsername.trim().length < 3 || this.grantUsername.trim().length > 40)
      return 'Enter a registered friend’s username (3–40 characters)';
    if (!Number.isInteger(this.grantBudget) || this.grantBudget < 1 || this.grantBudget > 1_000_000_000_000)
      return 'Token budget must be a whole number from 1 to 1,000,000,000,000';
    if (!this.selectedGrantModels().length) return 'Select at least one enabled model';
    return '';
  }
  async saveGrant() {
    if (this.grantBusy()) return;
    const validationError = this.grantValidationError();
    if (validationError) {
      this.error.set(validationError);
      return;
    }
    const models = this.selectedGrantModels();
    this.grantBusy.set(true);
    this.error.set('');
    try {
      const body = this.grantId
        ? { budget: this.grantBudget, models }
        : {
            username: this.grantUsername.trim(),
            budget: this.grantBudget,
            models,
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
