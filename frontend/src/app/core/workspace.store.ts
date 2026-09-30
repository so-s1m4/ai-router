import { computed, inject, Injectable, signal } from '@angular/core';
import { AccountsService } from './accounts.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { ChatViewService } from './chat-view.service';
import { ChatService } from './chat.service';
import { ClipboardService } from './clipboard.service';
import { FeedbackService } from './feedback.service';
import { FileLibraryService } from './file-library.service';
import { FilePreviewService } from './file-preview.service';
import { FilesService } from './files.service';
import { LayoutService } from './layout.service';
import {
  Account,
  ChatSession,
  Project,
  ProviderId,
  Runner,
  sortSessions,
  TokenUsage,
  UsageWindow,
} from './models';
import { ModelsService } from './models.service';
import { NavigationService, PageId } from './navigation.service';
import { NotificationsService } from './notifications.service';
import { ProjectsService } from './projects.service';
import { RunnersService } from './runners.service';
import { SessionsService } from './sessions.service';
import { SharedAccessService } from './shared-access.service';
import { TaskFilesService } from './task-files.service';
import { UsageService } from './usage.service';
import { UsersService } from './users.service';
@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  readonly filesService = inject(FilesService);
  readonly filePreviewService = inject(FilePreviewService);
  readonly clipboardService = inject(ClipboardService);
  readonly chatService = inject(ChatService);
  readonly layoutService = inject(LayoutService);
  readonly runnerService = inject(RunnersService);
  readonly usersService = inject(UsersService);
  readonly chatViewService = inject(ChatViewService);
  readonly taskFilesService = inject(TaskFilesService);
  readonly modelService = inject(ModelsService);
  readonly projectService = inject(ProjectsService);
  readonly sessionService = inject(SessionsService);
  readonly auth = inject(AuthService);
  readonly sharingService = inject(SharedAccessService);
  readonly libraryService = inject(FileLibraryService);
  readonly notificationsService = inject(NotificationsService);
  readonly usageService = inject(UsageService);
  readonly accountService = inject(AccountsService);
  private readonly feedback = inject(FeedbackService);
  private readonly http = inject(ApiService);
  private readonly navigation = inject(NavigationService);

  registerMode = this.auth.registerMode;
  loggedIn = this.auth.loggedIn;
  page = this.navigation.page;
  isOwner = this.auth.isOwner;

  modelMenuOpen = signal(false);
  modelSearch = signal('');
  filteredPickerModels = computed(() => {
    const query = this.modelSearch().trim().toLocaleLowerCase();
    return this.modelService
      .models()
      .filter((m) => !query || (m.label + ' ' + m.id).toLocaleLowerCase().includes(query));
  });
  private modelPickerReturnFocus?: HTMLElement;
  openModelPicker(event: Event) {
    this.modelPickerReturnFocus = event.currentTarget as HTMLElement;
    (document.activeElement as HTMLElement)?.blur();
    this.modelSearch.set('');
    this.modelMenuOpen.set(true);
    requestAnimationFrame(() => {
      const dialog = document.getElementById('model-picker');
      const selected = dialog?.querySelector<HTMLElement>('.model-picker-selected');
      (selected || dialog?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
      selected?.scrollIntoView({ block: 'nearest' });
    });
  }
  closeModelPicker() {
    this.modelMenuOpen.set(false);
    this.modelPickerReturnFocus?.focus({ preventScroll: true });
    this.modelPickerReturnFocus = undefined;
  }
  onModelPickerKey(event: KeyboardEvent) {
    if (event.key === 'Tab') this.trapDialogFocus(event);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeModelPicker();
    }
  }
  choosePickerModel(id: string) {
    if (!this.modelService.models().some((m) => m.id === id)) return;
    this.modelService.selectModel(id);
    this.closeModelPicker();
  }

  availableAccountsCount = computed(
    () =>
      this.accountService.accounts().filter((a) => this.accountService.accountAvailable(a)).length,
  );
  totalResetCredits = computed(() =>
    this.accountService
      .accounts()
      .reduce((sum, a) => sum + (a.limit?.resetCredits?.availableCount || 0), 0),
  );

  notice = this.feedback.notice;
  error = this.feedback.error;

  now = this.feedback.now;

  durationSince(at?: string) {
    if (!at) return '—';
    const seconds = Math.max(0, Math.floor((this.now() - Date.parse(at)) / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  private clock?: ReturnType<typeof setInterval>;

  currentProject = computed(() => {
    const pId = this.sessionService.current()?.projectId || this.projectService.selectedProjectId();
    return pId ? this.projectService.projects().find((p) => p.id === pId) : null;
  });

  ngOnInit() {
    this.navigation.onPageChange((page) => {
      if (this.loggedIn()) this.activatePage(page);
    });
    this.clock = setInterval(() => {
      this.now.set(Date.now());
      if (
        this.loggedIn() &&
        this.page() === 'operations' &&
        Math.floor(Date.now() / 1000) % 5 === 0
      ) {
        void this.usageService.refreshTasks();
        void this.usageService.refreshUsageSummary();
      }
    }, 1000);
    if (typeof window !== 'undefined') {
      window.addEventListener('dragover', this.filesService.preventWindowDrop);
      window.addEventListener('drop', this.filesService.preventWindowDrop);
      window.addEventListener('resize', this.chatViewService.onViewportResize);
      document.addEventListener('focusin', this.chatViewService.onViewportResize);
      document.addEventListener('focusout', this.chatViewService.onViewportResize);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this.chatViewService.onViewportResize);
        window.visualViewport.addEventListener('scroll', this.chatViewService.onViewportResize);
      }
    }
    this.chatViewService.onViewportResize();
    this.restore();
  }
  ngOnDestroy() {
    this.navigation.stop();
    this.filePreviewService.closePreview();
    this.chatService.socket?.disconnect();
    if (this.clock) clearInterval(this.clock);
    if (this.chatViewService.scrollRaf) cancelAnimationFrame(this.chatViewService.scrollRaf);
    this.chatViewService.cleanupResizeObserver();
    if (this.chatViewService.smoothScrollTimeout)
      clearTimeout(this.chatViewService.smoothScrollTimeout);
    if (typeof window !== 'undefined') {
      window.removeEventListener('dragover', this.filesService.preventWindowDrop);
      window.removeEventListener('drop', this.filesService.preventWindowDrop);
      window.removeEventListener('resize', this.chatViewService.onViewportResize);
      document.removeEventListener('focusin', this.chatViewService.onViewportResize);
      document.removeEventListener('focusout', this.chatViewService.onViewportResize);
      if (this.chatViewService.viewportRaf !== undefined)
        cancelAnimationFrame(this.chatViewService.viewportRaf);
      document.documentElement.classList.remove('keyboard-open');
      document.documentElement.style.removeProperty('--app-height');
      document.documentElement.style.removeProperty('--app-top');
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.chatViewService.onViewportResize);
        window.visualViewport.removeEventListener('scroll', this.chatViewService.onViewportResize);
      }
    }
  }
  api<T>(path: string, options: RequestInit = {}): Promise<T> {
    return this.http.request<T>(path, options);
  }

  formatChatsCount(n: number): string {
    return `${n} ${n === 1 ? 'chat' : 'chats'}`;
  }

  async restore() {
    if (!(await this.auth.ensureSession())) return;
    this.chatService.connect();
    try {
      await this.load();
      const linked = new URLSearchParams(location.search).get('session');
      if (linked) await this.chatService.openSession(linked);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
  async login() {
    if (!(await this.auth.login())) return;
    try {
      await this.load();
      this.chatService.connect();
      const linked = new URLSearchParams(location.search).get('session');
      if (linked) await this.chatService.openSession(linked);
    } catch (error) {
      this.auth.loginError = (error as Error).message;
    }
  }
  async logout() {
    await this.auth.logout();
    this.chatService.socket?.disconnect();
    this.notificationsService.browserNotifications.set(false);
    this.filePreviewService.closePreview();
    this.libraryService.fileGroups.set([]);
    this.notificationsService.telegram.set(null);
    this.notificationsService.telegramLink.set('');
    this.runnerService.managedRunner.set(null);
    this.modelService.modelBlacklist.set([]);
    this.isOwner.set(false);
    this.usersService.users.set([]);
    this.sharingService.grants.set([]);
    this.sharingService.grantEditor.set(false);
    this.loggedIn.set(false);
    this.sessionService.current.set(null);
  }
  async load() {
    const [accounts, runners, projects, sessions, blacklistRes] = await Promise.all([
      this.api<Account[]>('/accounts'),
      this.api<Runner[]>('/runners'),
      this.api<Project[]>('/projects'),
      this.api<ChatSession[]>('/sessions'),
      this.api<{ blacklist: string[] }>('/user/model-blacklist').catch(() => ({ blacklist: [] })),
    ]);
    this.accountService.accounts.set(accounts);
    void this.sharingService.refreshGrants();
    this.runnerService.runners.set(runners);
    this.projectService.projects.set(projects);
    if (blacklistRes?.blacklist) {
      this.modelService.modelBlacklist.set(blacklistRes.blacklist);
    }
    this.modelService.selectedService.set('auto');
    this.modelService.selectedAccount = 'auto';
    const available = this.modelService.models();
    if (!available.some((m) => m.id === this.modelService.selectedModel()))
      this.modelService.selectedModel.set('default');
    this.modelService.validateReasoning();
    this.accountService.selectedRunner = runners.find((r) => !r.revokedAt)?.id || '';
    const cleanSessions = sortSessions(sessions);
    this.sessionService.sessions.set(cleanSessions);
    void this.runnerService.refreshPreviews();
    this.sessionService.current.set(null);
    this.activatePage(this.page());
  }

  chatsFor(projectId?: string) {
    return sortSessions(
      this.sessionService
        .sessions()
        .filter((s) => (projectId ? s.projectId === projectId : !s.projectId)),
    );
  }
  projectIcon(p: Project | string): 'folder' | 'graduation-cap' | 'origami' {
    const name = typeof p === 'string' ? p : p.name;
    if (name === 'HTLink') return 'graduation-cap';
    if (name === 'Origami') return 'origami';
    return 'folder';
  }

  isProjectExpanded(p: Project | string): boolean {
    const key = typeof p === 'string' ? p : p.id || p.name;
    const name = typeof p === 'string' ? p : p.name;
    return (
      this.layoutService.expandedProjects().has(key) ||
      this.layoutService.expandedProjects().has(name)
    );
  }

  chatsForProject(p: Project): ChatSession[] {
    return this.chatsFor(p.id);
  }

  filteredRecentSessions = computed(() => {
    const query = this.layoutService.sidebarSearch().trim().toLowerCase();
    const all = sortSessions(this.sessionService.sessions()).filter((s) => !s.projectId);
    if (!query) return all;
    return all.filter((s) => s.title.toLowerCase().includes(query));
  });

  filteredProjects = computed(() => {
    const query = this.layoutService.sidebarSearch().trim().toLowerCase();
    const all = this.projectService.projects();
    if (!query) return all;
    return all.filter((p) => p.name.toLowerCase().includes(query));
  });

  selectProject(id: string) {
    this.projectService.selectedProjectId.set(id);
    const latest = this.chatsFor(id)[0];
    if (latest) void this.chatService.openSession(latest.id);
    else this.chatService.newSession();
  }
  newSessionFor(projectId: string) {
    this.projectService.selectedProjectId.set(projectId);
    this.chatService.newSession();
  }
  createProject() {
    this.projectService.newProjectName = '';
    this.projectService.newProjectShared = false;
    this.projectService.newProjectMembers = '';
    this.projectService.newProjectRunner =
      this.accountService.selectedRunner ||
      this.runnerService.runners().find((r) => !r.revokedAt)?.id ||
      '';
    this.projectService.projectCreateError.set('');
    this.projectService.projectCreateOpen.set(true);
    setTimeout(() => document.getElementById('project-name')?.focus(), 0);
  }
  trapDialogFocus(event: Event) {
    const keyboard = event as KeyboardEvent;
    const dialog = event.currentTarget as HTMLElement;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ),
    );
    const first = focusable[0],
      last = focusable[focusable.length - 1];
    if (keyboard.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!keyboard.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  async saveProject() {
    const name = this.projectService.newProjectName.trim();
    const runnerId = this.projectService.newProjectRunner;
    if (!name || this.projectService.projectSaving()) return;
    if (!runnerId) {
      this.projectService.projectCreateError.set(
        'First, connect a runner in the “Runners” section.',
      );
      return;
    }
    this.projectService.projectSaving.set(true);
    this.projectService.projectCreateError.set('');
    try {
      const project = await this.api<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name,
          runnerId,
          shared: this.projectService.newProjectShared,
          members: this.projectService.newProjectShared
            ? this.projectService.memberNames(this.projectService.newProjectMembers)
            : [],
        }),
      });
      this.projectService.projects.update((v) => [project, ...v]);
      this.modelService.selectTaskProject(project.id);
      this.projectService.projectCreateOpen.set(false);
      this.chatService.newSession();
    } catch (e) {
      this.projectService.projectCreateError.set((e as Error).message);
    } finally {
      this.projectService.projectSaving.set(false);
    }
  }

  showPage(
    page:
      | 'chat'
      | 'projects'
      | 'sites'
      | 'providers'
      | 'connections'
      | 'runners'
      | 'users'
      | 'files'
      | 'notifications'
      | 'operations',
  ) {
    if (page === 'users' && !this.isOwner()) return;
    this.layoutService.mobileMenu.set(false);
    if (page === 'chat') this.navigation.navigateChat(this.sessionService.current()?.id);
    else this.navigation.navigate(page);
  }
  activatePage(page: PageId) {
    this.layoutService.mobileMenu.set(false);
    if (page === 'runners') this.runnerService.refreshRunners();
    else this.runnerService.managedRunner.set(null);
    if (page === 'connections') {
      void this.accountService.refreshAccounts();
      void this.sharingService.refreshGrants();
    }
    if (page === 'operations') {
      void this.usageService.refreshTasks();
      void this.usageService.refreshUsageSummary();
    }
    if (page === 'files') void this.libraryService.refreshLibrary();
    if (page === 'notifications') void this.notificationsService.refreshTelegram();
    if (page === 'sites') void this.runnerService.refreshPreviews();
    if (page === 'providers') void this.modelService.refreshProviders();
    if (page === 'users') void this.usersService.refreshUsers();
    if (page === 'chat') this.chatViewService.ensureChatScrollAttached(true);
    else this.chatViewService.cleanupResizeObserver();
  }

  loginCommand(a: Account) {
    return `docker compose -f runner/compose.yaml exec runner /app/scripts/provider-login.sh ${a.provider} ${a.id}`;
  }

  accountLabel(id: string) {
    return this.accountService.accounts().find((a) => a.id === id)?.name || '';
  }
  providerLabel(id?: ProviderId | string) {
    return id === 'codex'
      ? 'Codex'
      : id === 'antigravity' || id === 'gemini'
        ? 'Gemini'
        : id === 'chatgpt'
          ? 'ChatGPT'
          : '';
  }
  tokenLabel(usage?: TokenUsage) {
    return usage
      ? `${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(usage.totalTokens)} tokens`
      : '— tokens';
  }
  tokenTitle(usage?: TokenUsage) {
    if (!usage) return 'The provider did not transmit the token consumption for this request';
    const format = (value: number) => new Intl.NumberFormat('en-US').format(value);
    const rows = [`Total per request: ${format(usage.totalTokens)} tokens`];
    if (usage.inputTokens !== undefined) rows.push(`Input: ${format(usage.inputTokens)}`);
    if (usage.outputTokens !== undefined) rows.push(`Output: ${format(usage.outputTokens)}`);
    if (usage.cachedInputTokens !== undefined)
      rows.push(`Cached input: ${format(usage.cachedInputTokens)}`);
    if (usage.reasoningOutputTokens !== undefined)
      rows.push(`Reasoning: ${format(usage.reasoningOutputTokens)}`);
    return rows.join('\n');
  }

  limitLabel(a: Account) {
    if (a.limit.cooldownUntil) return 'Limited';
    if (a.limit.primary || a.limit.secondary) return 'Account quota';
    return 'Provider';
  }
  windowLabel(window: UsageWindow) {
    const minutes = window.windowMinutes;
    if (minutes === 300) return '5 h';
    if (minutes === 10080) return 'Week';
    if (minutes === 43200) return 'Month';
    if (minutes && minutes % 60 === 0) return `${minutes / 60} h`;
    return 'Window';
  }
  remaining(window: UsageWindow | null) {
    return window ? `${Math.round(window.remainingPercent)}%` : '';
  }
  resetLabel(window: UsageWindow) {
    if (!window.resetAt) return '';
    const date = new Date(window.resetAt);
    return Number.isFinite(date.getTime())
      ? `Resets ${new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)}`
      : '';
  }
  accountMode(a: Account) {
    return a.mode === 'runner'
      ? 'Container online'
      : a.mode === 'offline'
        ? 'Offline'
        : 'No container';
  }

  chatgptSessionModal = signal(false);
  selectedChatGPTAccount = signal<Account | null>(null);
  chatgptSessionInput = '';
  chatgptImporting = signal(false);

  openChatGPTSessionModal(a: Account) {
    this.selectedChatGPTAccount.set(a);
    this.chatgptSessionInput = '';
    this.chatgptSessionModal.set(true);
  }

  closeChatGPTSessionModal() {
    this.chatgptSessionModal.set(false);
    this.selectedChatGPTAccount.set(null);
    this.chatgptSessionInput = '';
  }

  async saveChatGPTSession() {
    const acc = this.selectedChatGPTAccount();
    if (!acc) return;
    const raw = this.chatgptSessionInput.trim();
    if (!raw) return;
    this.chatgptImporting.set(true);
    this.error.set('');
    try {
      let payload: { sessionToken?: string; cookies?: any[] };
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) payload = { cookies: parsed };
        else if (typeof parsed === 'object' && parsed !== null) payload = parsed;
        else payload = { sessionToken: String(parsed) };
      } catch {
        payload = { sessionToken: raw };
      }

      await this.api(`/accounts/${acc.id}/chatgpt-session`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      this.notice.set('ChatGPT session saved successfully!');
      this.closeChatGPTSessionModal();
      await this.accountService.refreshAccounts();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.chatgptImporting.set(false);
    }
  }
}
