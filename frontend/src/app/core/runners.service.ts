import { inject, Injectable, signal } from '@angular/core';
import { AccountsService } from './accounts.service';
import { ApiService } from './api.service';
import { FeedbackService } from './feedback.service';
import { Pairing, Preview, Project, Runner } from './models';
import { NavigationService } from './navigation.service';
@Injectable({ providedIn: 'root' })
export class RunnersService {
  private readonly http = inject(ApiService);
  private readonly feedback = inject(FeedbackService);
  readonly error = this.feedback.error;
  readonly notice = this.feedback.notice;
  private readonly accountService = inject(AccountsService);
  private readonly navigation = inject(NavigationService);
  readonly page = this.navigation.page;
  refreshAccounts() {
    return this.accountService.refreshAccounts();
  }
  get selectedRunner() {
    return this.accountService.selectedRunner;
  }
  set selectedRunner(value: string) {
    this.accountService.selectedRunner = value;
  }
  managedRunner = signal<Runner | null>(null);
  runners = signal<Runner[]>([]);
  previews = signal<Preview[]>([]);
  pairing = signal<Pairing | null>(null);
  runnerName = 'My computer';
  async refreshRunners() {
    const rows = await this.http.request<Runner[]>('/runners');
    this.runners.set(rows);
    const managed = this.managedRunner();
    if (managed) this.managedRunner.set(rows.find((row) => row.id === managed.id) || null);
    await this.refreshAccounts();
    if (!this.selectedRunner)
      this.selectedRunner = this.runners().find((r) => !r.revokedAt)?.id || '';
  }
  projectRunner(project: Project) {
    if (project.shared) return 'Shared across runners';
    return this.runners().find((r) => r.id === project.runnerId)?.name || 'Runner';
  }
  async refreshPreviews() {
    try {
      const rows = await Promise.all(
        this.runners()
          .filter((r) => !r.revokedAt)
          .map((r) => this.http.request<Preview[]>('/runners/' + r.id + '/previews')),
      );
      this.previews.set(rows.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch (e) {
      if (this.page() === 'sites') this.error.set((e as Error).message);
    }
  }
  async setPreviewVisible(preview: Preview, visible: boolean) {
    try {
      await this.http.request('/runners/' + preview.runnerId + '/previews/' + preview.subdomain, {
        method: 'PATCH',
        body: JSON.stringify({ visible }),
      });
      await this.refreshPreviews();
      this.notice.set(visible ? 'The site is open' : 'Site hidden');
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  previewRunner(preview: Preview) {
    return this.runners().find((r) => r.id === preview.runnerId)?.name || 'Runner';
  }
  runnerInstructionTab = signal<'quick' | 'detailed'>('quick');
  serverOrigin(): string {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return 'https://ai.s1m4.com';
  }
  pairingCodePlaceholder(): string {
    return this.pairing()?.code || '<YOUR_PAIRING_CODE>';
  }
  quickStartCommand(): string {
    const url = this.serverOrigin();
    const code = this.pairingCodePlaceholder();
    return `git clone https://github.com/so-s1m4/ai-router.git && cd ai-router/runner && ROUTER_SERVER_URL="${url}" ROUTER_PAIRING_CODE="${code}" docker compose up --build -d`;
  }
  quickStartExistingCommand(): string {
    const url = this.serverOrigin();
    const code = this.pairingCodePlaceholder();
    return `cd ai-router/runner && ROUTER_SERVER_URL="${url}" ROUTER_PAIRING_CODE="${code}" docker compose up --build -d`;
  }
  async createPairing() {
    this.error.set('');
    try {
      this.pairing.set(
        await this.http.request<Pairing>('/runners/pairing', {
          method: 'POST',
          body: JSON.stringify({ name: this.runnerName }),
        }),
      );
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  async revokeRunner(r: Runner) {
    if (!confirm(`Disable ${r.name}? Its tasks will stop.`)) return;
    try {
      await this.http.request('/runners/' + r.id, { method: 'DELETE' });
      await this.refreshRunners();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}
