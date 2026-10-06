import { computed, inject, Injectable, signal } from '@angular/core';
import { Socket } from 'socket.io-client';
import { AccountsService } from './accounts.service';
import { ApiService } from './api.service';
import { ChatViewService } from './chat-view.service';
import { FeedbackService } from './feedback.service';
import { LayoutService } from './layout.service';
import {
  Account,
  AIEvent,
  ChatSession,
  ProviderId,
  RunActivity,
  RunState,
  sortSessions,
} from './models';
import { ModelsService } from './models.service';
import { NavigationService } from './navigation.service';
import { NotificationsService } from './notifications.service';
import { ProjectsService } from './projects.service';
import { RealtimeService } from './realtime.service';
import { SessionsService } from './sessions.service';
import { TaskFilesService } from './task-files.service';
import { UsageService } from './usage.service';
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(ApiService);
  private readonly feedback = inject(FeedbackService);
  readonly error = this.feedback.error;
  readonly notice = this.feedback.notice;
  readonly now = this.feedback.now;
  private readonly realtime = inject(RealtimeService);
  private readonly navigation = inject(NavigationService);
  private readonly layoutService = inject(LayoutService);
  readonly page = this.navigation.page;
  readonly mobileMenu = this.layoutService.mobileMenu;
  private readonly accountService = inject(AccountsService);
  private readonly modelService = inject(ModelsService);
  private readonly sessionService = inject(SessionsService);
  private readonly projectService = inject(ProjectsService);
  private readonly notificationsService = inject(NotificationsService);
  private readonly usageService = inject(UsageService);
  private readonly taskFilesService = inject(TaskFilesService);
  private readonly chatViewService = inject(ChatViewService);
  accountLabel(id: string) {
    return this.accountService.accounts().find((a) => a.id === id)?.name || '';
  }
  providerLabel(id?: string) {
    return id === 'cerebras' ? 'Cerebras' : id === 'openrouter' ? 'OpenRouter' : id === 'codex'
      ? 'Codex'
      : id === 'gemini' || id === 'antigravity'
        ? 'Gemini'
        : id === 'chatgpt'
          ? 'ChatGPT'
          : '';
  }
  steeringAvailable = signal(false);
  steeringSending = signal(false);
  async steer() {
    const prompt = this.draft.trim(),
      sessionId = this.sessionService.current()?.id,
      runId = this.runId();
    if (
      !prompt ||
      !sessionId ||
      !runId ||
      !this.steeringAvailable() ||
      this.steeringSending() ||
      !this.socket?.connected
    )
      return;
    this.steeringSending.set(true);
    this.error.set('');
    try {
      const reply = await this.socket.timeout(40000).emitWithAck('steer', { runId, prompt });
      if (!reply?.ok) throw new Error(reply?.error || 'Failed to send clarification');
      if (this.sessionService.current()?.id === sessionId && this.draft.trim() === prompt) {
        this.draft = '';
        this.chatViewService.adjustTextareaHeight();
      }
      this.notice.set('The refinement is passed to the model');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.steeringSending.set(false);
    }
  }
  draft = '';
  running = signal(false);
  canceling = signal(false);
  runId = signal('');
  stream = signal('');
  activeAccount = signal('');
  activeProvider = signal<ProviderId | undefined>(undefined);
  activity = signal<RunActivity[]>([]);
  runStartedAt = signal('');
  taskSubmitting = signal(false);
  lastActivityAt = signal('');
  waitingTasks = computed(() => this.usageService.tasks().filter((t) => t.state === 'queued'));
  currentWaitingTasks = computed(() =>
    this.waitingTasks().filter((t) => t.input.sessionId === this.sessionService.current()?.id),
  );
  currentInterruptedTasks = computed(() =>
    this.usageService
      .tasks()
      .filter(
        (t) =>
          t.input.sessionId === this.sessionService.current()?.id &&
          this.usageService.canResumeTask(t) &&
          !this.sessionService.current()?.messages.some(
            (m) => m.role === 'user' && !!m.at && m.at > t.updatedAt,
          ) &&
          !this.usageService.tasks().some(
            (later) => later.input.sessionId === t.input.sessionId && later.createdAt > t.updatedAt,
          ),
      ),
  );
  socket?: Socket;
  newSession() {
    this.layoutService.mobileMenu.set(false);
    this.sessionService.current.set(null);
    this.taskFilesService.taskFiles.set([]);
    this.taskFilesService.selectedTaskFiles.set(new Set());
    this.taskFilesService.sharedFileLinks.set({});
    this.taskFilesService.collapsedDirs.set(new Set());
    this.taskFilesService.filesFilter.set('');
    this.taskFilesService.filesOpen.set(false);

    this.navigation.navigateChat();
    this.resetRun();
    this.error.set('');
    this.chatViewService.ensureChatScrollAttached(true);
  }
  deletingSessions = signal(new Set<string>());
  private readonly deletedSessions = new Set<string>();
  private removeSession(id: string) {
    this.deletedSessions.add(id);
    this.sessionService.sessions.update(rows => rows.filter(s => s.id !== id));
    if (this.sessionService.current()?.id === id) {
      this.draft = '';
      this.newSession();
    }
  }
  async deleteSession(id: string) {
    if (this.deletingSessions().has(id)) return;
    const title = this.sessionService.sessions().find(s => s.id === id)?.title || 'this chat';
    if (!window.confirm(`Delete "${title}"? Active and queued tasks will stop. This cannot be undone.`)) return;
    this.deletingSessions.update(ids => new Set([...ids, id]));
    this.error.set('');
    try {
      await this.http.request('/sessions/' + id, { method: 'DELETE' });
      this.removeSession(id);
      this.notice.set('Chat deleted');
      void this.usageService.refreshTasks();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.deletingSessions.update(ids => { const next = new Set(ids); next.delete(id); return next; });
    }
  }
  async openSession(id: string) {
    this.layoutService.mobileMenu.set(false);
    try {
      const s = await this.http.request<ChatSession>('/sessions/' + id);
      if (this.deletedSessions.has(id)) return;
      this.sessionService.current.set(s);
      this.taskFilesService.taskFiles.set([]);
      this.taskFilesService.selectedTaskFiles.set(new Set());
      this.taskFilesService.sharedFileLinks.set({});
      this.taskFilesService.collapsedDirs.set(new Set());
      this.taskFilesService.filesFilter.set('');
      this.taskFilesService.filesOpen.set(false);
      this.projectService.selectedProjectId.set(s.projectId || '');
      this.resetRun();
      this.error.set('');
      this.navigation.navigateChat(id);
      this.syncRun(id);
      this.chatViewService.ensureChatScrollAttached(true);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  connect() {
    this.socket?.disconnect();
    this.socket = this.realtime.connect();
    this.socket.on('connect', () => {
      if (this.error() === 'The connection to the server is lost') this.error.set('');
      void this.usageService.refreshTasks();
      const id = this.sessionService.current()?.id;
      if (id) this.syncRun(id);
    });
    this.socket.on('session:deleted', (id: string) => this.removeSession(id));
    this.socket.on('queue:changed', () => void this.usageService.refreshTasks());
    this.socket.on('disconnect', () => {
      if (this.running()) this.notice.set('Connection lost. Restoring the task status...');
    });
    this.socket.on('ai:event', (e: AIEvent) => this.onEvent(e));
    this.socket.on('accounts:changed', (a: Account[]) => {
      this.accountService.accounts.set(a);
      const available = this.modelService.models();
      if (!available.some((m) => m.id === this.modelService.selectedModel()))
        this.modelService.selectedModel.set('default');
      this.modelService.validateReasoning();
    });
    this.socket.on('connect_error', () => this.error.set('The connection to the server is lost'));
  }
  resetRun() {
    this.steeringAvailable.set(false);
    this.running.set(false);
    this.runId.set('');
    this.stream.set('');
    this.activeAccount.set('');
    this.activeProvider.set(undefined);
    this.activity.set([]);
    this.runStartedAt.set('');
  }
  syncRun(sessionId: string) {
    if (!this.socket?.connected) return;
    this.socket.emit('run:state', sessionId, (state: RunState | null) => {
      if (this.sessionService.current()?.id !== sessionId) return;
      if (!state) {
        const wasRunning = this.running();
        this.resetRun();
        this.notice.set('');
        if (wasRunning) this.notice.set('Connection restored. Check saved progress below.');
        void this.usageService.refreshTasks();
        void this.reloadCurrent();
        return;
      }
      if ('type' in state) {
        const wasRunning = this.running() || this.runId() === state.runId;
        this.resetRun();
        this.notice.set('');
        if (wasRunning) {
          if (state.type === 'error') this.error.set(state.message);
          else {
            this.error.set('');
            this.notice.set(state.message || 'Done');
          }
        }
        void this.reloadCurrent();
        return;
      }
      this.steeringAvailable.set(state.steeringAvailable === true);
      this.runId.set(state.runId);
      this.running.set(true);
      this.runStartedAt.set(state.startedAt);
      this.lastActivityAt.set(
        state.lastActivityAt || state.activity?.at(-1)?.at || state.startedAt,
      );
      this.activeAccount.set(state.accountId || '');
      if (state.provider) this.activeProvider.set(state.provider);
      this.stream.set(state.stream || '');
      this.activity.set(state.activity || []);
      this.notice.set(state.message || 'Task in progress');
      this.error.set('');
      this.chatViewService.requestScrollToBottom();
    });
  }
  onEvent(e: AIEvent) {
    if (
      e.type === 'completed' &&
      this.notificationsService.browserNotifications() &&
      'Notification' in window &&
      Notification.permission === 'granted' &&
      (document.hidden ||
        e.sessionId !== this.sessionService.current()?.id ||
        this.page() !== 'chat')
    ) {
      const n = new Notification('The answer is ready', {
        body:
          this.sessionService.sessions().find((s) => s.id === e.sessionId)?.title || 'AI Router',
      });
      n.onclick = () => {
        window.focus();
        void this.openSession(e.sessionId);
        n.close();
      };
    }
    if (e.sessionId !== this.sessionService.current()?.id) return;
    this.lastActivityAt.set(e.at || new Date().toISOString());
    if (e.type === 'fallback' || e.type === 'handoff_started') this.steeringAvailable.set(false);
    if (typeof e.data?.steeringAvailable === 'boolean')
      this.steeringAvailable.set(e.data.steeringAvailable);
    if (e.data?.steeringMessage) {
      const message = e.data.steeringMessage;
      this.sessionService.current.update((s) =>
        s && !s.messages.some((m) => m.id === message.id)
          ? { ...s, messages: [...s.messages, message], updatedAt: message.at || s.updatedAt }
          : s,
      );
    }
    if (e.provider) this.activeProvider.set(e.provider as ProviderId);
    if (e.type === 'started') {
      this.running.set(true);
      this.runId.set(e.runId);
      this.runStartedAt.set(new Date().toISOString());
      this.activity.set([]);
      this.notice.set(e.message || 'Request accepted');
      void this.reloadCurrent();
      this.chatViewService.requestScrollToBottom();
    } else if (e.type === 'delta') {
      this.stream.update((s) => s + (e.text || ''));
      this.activeAccount.set(e.data?.accountId || '');
      this.chatViewService.requestScrollToBottom();
    } else if (
      e.type === 'status' ||
      e.type === 'tool' ||
      e.type === 'fallback' ||
      e.type === 'checkpoint' ||
      e.type === 'handoff_started' ||
      e.type === 'handoff_ready'
    ) {
      if (e.type === 'handoff_started') this.stream.set('');
      if (e.message) {
        this.notice.set(e.message);
        this.activity.update((rows) =>
          [
            ...rows,
            {
              type: e.type,
              message: e.message!,
              at: new Date().toISOString(),
              provider: e.provider as ProviderId,
              accountId: e.data?.accountId,
            },
          ].slice(-12),
        );
      }
      this.activeAccount.set(e.data?.accountId || this.activeAccount());
      this.chatViewService.requestScrollToBottom();
    } else if (e.type === 'error') {
      this.error.set(e.message || 'Error');
      this.resetRun();
      this.reloadCurrent();
    } else if (e.type === 'completed') {
      this.resetRun();
      this.notice.set(e.message || 'Done');
      this.reloadCurrent();
      void this.taskFilesService.refreshTaskFiles();
    }
  }
  async reloadCurrent() {
    const id = this.sessionService.current()?.id;
    if (!id) return;
    let s: ChatSession;
    try {
      s = await this.http.request<ChatSession>('/sessions/' + id);
    } catch (e) {
      if (this.sessionService.current()?.id === id && !this.deletedSessions.has(id))
        this.error.set((e as Error).message);
      return;
    }
    if (this.sessionService.current()?.id !== id || this.deletedSessions.has(id)) return;
    this.sessionService.current.set(s);
    this.sessionService.sessions.update((list) => {
      const next = list.map((x) => (x.id === s.id ? s : x));
      if (!next.some((x) => x.id === s.id) && s.messages && s.messages.length > 0) {
        next.push(s);
      }
      return sortSessions(next);
    });
    this.chatViewService.requestScrollToBottom();
  }
  async send(enqueue = false) {
    const prompt = this.draft.trim();
    if (this.running() && !enqueue) {
      await this.steer();
      return;
    }
    if (!prompt || this.taskSubmitting()) return;
    if (!this.socket?.connected) {
      this.error.set('The connection to the server is lost');
      return;
    }
    this.taskSubmitting.set(true);
    try {
      let chat = this.sessionService.current();
      if (!chat?.id) {
        const projectId = this.projectService.selectedProjectId() || undefined;
        chat = await this.http.request<ChatSession>('/sessions', {
          method: 'POST',
          body: JSON.stringify(projectId ? { projectId } : {}),
        });
        this.sessionService.current.set(chat);
      }
      const service = this.modelService.selectedService();
      const ack = await this.socket.timeout(15000).emitWithAck('run', {
        sessionId: chat.id,
        prompt,
        service,
        accountId: service,
        model: this.modelService.selectedModel(),
        reasoning: this.modelService.selectedReasoning(),
        fast: service === 'codex' && this.modelService.codexFast(),
        workflow: this.modelService.workflow(),
        mode: 'task',
      });
      if (!ack.ok) throw new Error(ack.error || 'Unable to queue task');
      this.draft = '';
      this.error.set('');
      if (!this.running()) this.notice.set('Task added to queue');
      setTimeout(() => this.chatViewService.adjustTextareaHeight(), 0);
      await this.usageService.refreshTasks();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.taskSubmitting.set(false);
    }
  }
  async cancel() {
    const runId = this.runId();
    if (!runId || this.canceling()) return;
    this.canceling.set(true);
    this.error.set('');
    try {
      await this.http.request('/tasks/' + runId, { method: 'DELETE' });
      if (this.runId() === runId && this.running()) this.notice.set('Stopping task…');
      await this.usageService.refreshTasks();
      const sessionId = this.sessionService.current()?.id;
      if (this.runId() === runId && sessionId) this.syncRun(sessionId);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.canceling.set(false);
    }
  }
  elapsed() {
    const start = Date.parse(this.runStartedAt());
    if (!Number.isFinite(start)) return '0:00';
    const seconds = Math.max(0, Math.floor((this.now() - start) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  currentRunnerLabel(): string {
    const name = this.accountLabel(this.activeAccount());
    if (name) return name;
    const prov = this.activeProvider();
    if (prov) return this.providerLabel(prov);
    const modelId = this.modelService.selectedModel();
    if (modelId !== 'default') {
      const m =
        this.modelService.models().find((x) => x.id === modelId) ||
        this.modelService.allGeminiModels().find((x) => x.id === modelId) ||
        this.modelService.allCodexModels().find((x) => x.id === modelId) ||
        this.modelService.allChatGPTModels().find((x) => x.id === modelId);
      if (m) return m.label.replace(/\s*·\s*(Gemini|Codex|ChatGPT)$/, '');
    }
    const s = this.modelService.selectedService();
    return s === 'cerebras' ? 'Cerebras' : s === 'openrouter' ? 'OpenRouter' : s === 'gemini' ? 'Gemini' : s === 'codex' ? 'Codex' : 'ChatGPT';
  }
  onComposerEnter(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (window.matchMedia('(pointer: coarse)').matches && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    void this.send();
  }
}
