import { computed, inject, Injectable, signal } from '@angular/core';
import { AccountsService } from './accounts.service';
import { ApiService } from './api.service';
import { FeedbackService } from './feedback.service';
import {
  DEFAULT_CHATGPT_MODELS,
  DEFAULT_CODEX_MODELS,
  DEFAULT_GEMINI_MODELS,
  Model,
  ProviderId,
  ReasoningEffort,
  ServiceId,
} from './models';
import { NavigationService } from './navigation.service';
import { ProjectsService } from './projects.service';
import { SessionsService } from './sessions.service';
@Injectable({ providedIn: 'root' })
export class ModelsService {
  private readonly http = inject(ApiService);
  private readonly feedback = inject(FeedbackService);
  readonly error = this.feedback.error;
  readonly notice = this.feedback.notice;
  private readonly accountService = inject(AccountsService);
  private readonly projectService = inject(ProjectsService);
  private readonly sessionService = inject(SessionsService);
  private readonly navigation = inject(NavigationService);
  readonly accounts = this.accountService.accounts;
  readonly projects = this.projectService.projects;
  readonly selectedProjectId = this.projectService.selectedProjectId;
  readonly current = this.sessionService.current;
  readonly page = this.navigation.page;
  refreshAccounts() {
    return this.accountService.refreshAccounts();
  }
  modelBlacklist = signal<string[]>([]);
  currentServiceLabel = computed(() => {
    const s = this.selectedService();
    if (s === 'cerebras') return 'Cerebras';
    if (s === 'openrouter') return 'OpenRouter';
    if (s === 'gemini') return 'Gemini';
    if (s === 'codex') return 'Codex';
    if (s === 'chatgpt') return 'ChatGPT';
    return 'Auto';
  });
  currentModelBadgeLabel = computed(() => {
    const modelId = this.selectedModel();
    if (modelId === 'auto') return 'Auto model';
    if (modelId === 'default') {
      const s = this.selectedService();
      if (s === 'cerebras') return 'Cerebras';
      if (s === 'openrouter') return 'OpenRouter';
      if (s === 'chatgpt') return 'ChatGPT';
      if (s === 'gemini') return 'Gemini';
      if (s === 'codex') return 'Codex';
      return 'Model';
    }
    const m =
      this.models().find((item) => item.id === modelId) ||
      this.allGeminiModels().find((item) => item.id === modelId) ||
      this.allCodexModels().find((item) => item.id === modelId) ||
      this.allChatGPTModels().find((item) => item.id === modelId) || this.allOpenRouterModels().find(item=>item.id===modelId) || this.allCerebrasModels().find(item=>item.id===modelId);
    if (!m) return modelId;
    return m.label.replace(/\s*·\s*(Gemini|Codex|ChatGPT|OpenRouter|Cerebras)$/, '');
  });
  currentReasoningBadgeLabel = computed(() => {
    const r = this.selectedReasoning();
    const modelId = this.selectedModel();
    if (!r || r === 'default') {
      const currentModel =
        this.models().find((m) => m.id === modelId) ||
        this.allGeminiModels().find((m) => m.id === modelId) ||
        this.allCodexModels().find((m) => m.id === modelId) ||
        this.allChatGPTModels().find((m) => m.id === modelId) || this.allOpenRouterModels().find(m=>m.id===modelId) || this.allCerebrasModels().find(m=>m.id===modelId);
      if (currentModel?.defaultReasoning) {
        const opt = currentModel.reasoning?.find(
          (o: ReasoningEffort) => o.id === currentModel.defaultReasoning,
        );
        if (opt) return opt.label;
      }
      return 'Reasoning effort';
    }
    const opt = this.reasoningOptions().find((o) => o.id === r);
    if (opt && opt.id !== 'default') return opt.label;
    if (r === 'high') return 'High';
    if (r === 'medium') return 'Medium';
    if (r === 'low') return 'Low';
    if (r === 'max') return 'Max';
    return r.charAt(0).toUpperCase() + r.slice(1);
  });
  currentReasoningOrModelLabel = computed(() => this.currentReasoningBadgeLabel());
  selectedService = signal<ServiceId>('auto');
  selectedAccount = 'auto';
  selectedModel = signal<string>('auto');
  selectedReasoning = signal<string>('default');
  codexFast = signal(false);
  workflow = signal<'standard' | 'ccc-auto'>('standard');
  models = computed(() => {
    const autoModel: Model = { id: 'auto', label: 'Auto · by task complexity' };
    const blacklist = new Set(this.modelBlacklist());
    const allAccounts = Array.isArray(this.accounts()) ? this.accounts() : [];
    const pId = this.current()?.projectId || this.selectedProjectId();
    const project = pId ? this.projects().find((p) => p.id === pId) : null;
    const scoped =
      project && !project.shared
        ? allAccounts.filter((a) => a.runnerId === project.runnerId)
        : allAccounts;

    const service = this.selectedService();

    if (service === 'cerebras') {
      const map = new Map<string,Model>();
      map.set('default',{id:'default',label:'Cerebras default'});
      for(const a of scoped.filter(a=>a.provider==='cerebras'))for(const m of a.models || [])if(m.id!=='default')map.set(m.id,m);
      return [autoModel,...map.values()].filter(m=>m.id==='auto'||m.id==='default'||!blacklist.has(m.id));
    }
    if (service === 'openrouter') {
      const map = new Map<string,Model>();
      map.set('default',{id:'default',label:'OpenRouter auto'});
      for(const a of scoped.filter(a=>a.provider==='openrouter'))for(const m of a.models || [])if(m.id!=='default')map.set(m.id,m);
      return [autoModel,...map.values()].filter(m=>m.id==='auto'||m.id==='default'||!blacklist.has(m.id));
    }
    if (service === 'gemini') {
      const accModels = scoped
        .filter((a) => a.provider === 'antigravity')
        .flatMap((a) => a.models || []);
      const map = new Map<string, Model>();
      for (const m of DEFAULT_GEMINI_MODELS) map.set(m.id, { ...m });
      for (const m of accModels) if (m.id !== 'default') map.set(m.id, m);
      map.set('default', { id: 'default', label: 'Gemini default' });
      return [autoModel, ...map.values()].filter(
        (m) => m.id === 'auto' || m.id === 'default' || !blacklist.has(m.id),
      );
    }

    if (service === 'codex') {
      const accModels = scoped.filter((a) => a.provider === 'codex').flatMap((a) => a.models || []);
      const map = new Map<string, Model>();
      for (const m of DEFAULT_CODEX_MODELS) map.set(m.id, { ...m });
      for (const m of accModels) if (m.id !== 'default') map.set(m.id, m);
      map.set('default', { id: 'default', label: 'Codex default' });
      return [autoModel, ...map.values()].filter(
        (m) => m.id === 'auto' || m.id === 'default' || !blacklist.has(m.id),
      );
    }

    if (service === 'chatgpt') {
      const accModels = scoped
        .filter((a) => a.provider === 'chatgpt')
        .flatMap((a) => a.models || []);
      const map = new Map<string, Model>();
      for (const m of DEFAULT_CHATGPT_MODELS) map.set(m.id, { ...m });
      for (const m of accModels) if (m.id !== 'default') map.set(m.id, m);
      map.set('default', { id: 'default', label: 'ChatGPT default' });
      return [autoModel, ...map.values()].filter(
        (m) => m.id === 'auto' || m.id === 'default' || !blacklist.has(m.id),
      );
    }

    const map = new Map<string, Model>();
    map.set('default', { id: 'default', label: 'Default (Auto)' });
    for (const m of DEFAULT_GEMINI_MODELS)
      if (m.id !== 'default') map.set(m.id, { ...m, label: `${m.label} · Gemini` });
    for (const a of scoped.filter((x) => x.provider === 'antigravity')) {
      for (const m of a.models || [])
        if (m.id !== 'default' && !map.has(m.id))
          map.set(m.id, { ...m, label: `${m.label} · Gemini` });
    }
    for (const m of DEFAULT_CODEX_MODELS)
      if (m.id !== 'default') map.set(m.id, { ...m, label: `${m.label} · Codex` });
    for (const a of scoped.filter((x) => x.provider === 'codex')) {
      for (const m of a.models || [])
        if (m.id !== 'default' && !map.has(m.id))
          map.set(m.id, { ...m, label: `${m.label} · Codex` });
    }
    for (const m of DEFAULT_CHATGPT_MODELS)
      if (m.id !== 'default') map.set(m.id, { ...m, label: `${m.label} · ChatGPT` });
    for (const a of scoped.filter((x) => x.provider === 'chatgpt')) {
      for (const m of a.models || [])
        if (m.id !== 'default' && !map.has(m.id))
          map.set(m.id, { ...m, label: `${m.label} · ChatGPT` });
    }
    for(const a of scoped.filter(a=>a.provider==='openrouter'))for(const m of a.models || [])if(m.id!=='default')map.set(m.id,{...m,label:m.label+' · OpenRouter'});
    for(const a of scoped.filter(a=>a.provider==='cerebras'))for(const m of a.models || [])if(m.id!=='default')map.set(m.id,{...m,label:m.label+' · Cerebras'});
    return [autoModel, ...map.values()].filter(
      (m) => m.id === 'auto' || m.id === 'default' || !blacklist.has(m.id),
    );
  });
  allGeminiModels = computed(() => {
    const accounts = Array.isArray(this.accounts()) ? this.accounts() : [];
    const accModels = accounts
      .filter((a) => a.provider === 'antigravity')
      .flatMap((a) => a.models || []);
    const map = new Map<string, Model>();
    for (const m of DEFAULT_GEMINI_MODELS) if (m.id !== 'default') map.set(m.id, { ...m });
    for (const m of accModels) if (m.id !== 'default' && !map.has(m.id)) map.set(m.id, m);
    return [...map.values()];
  });
  allCodexModels = computed(() => {
    const accounts = Array.isArray(this.accounts()) ? this.accounts() : [];
    const accModels = accounts.filter((a) => a.provider === 'codex').flatMap((a) => a.models || []);
    const map = new Map<string, Model>();
    for (const m of DEFAULT_CODEX_MODELS) if (m.id !== 'default') map.set(m.id, { ...m });
    for (const m of accModels) if (m.id !== 'default' && !map.has(m.id)) map.set(m.id, m);
    return [...map.values()];
  });
  allChatGPTModels = computed(() => {
    const accounts = Array.isArray(this.accounts()) ? this.accounts() : [];
    const accModels = accounts
      .filter((a) => a.provider === 'chatgpt')
      .flatMap((a) => a.models || []);
    const map = new Map<string, Model>();
    for (const m of DEFAULT_CHATGPT_MODELS) if (m.id !== 'default') map.set(m.id, { ...m });
    for (const m of accModels) if (m.id !== 'default' && !map.has(m.id)) map.set(m.id, m);
    return [...map.values()];
  });
  allOpenRouterModels = computed(() => [...new Map(this.accounts().filter(a=>a.provider==='openrouter').flatMap(a=>a.models || []).filter(m=>m.id!=='default').map(m=>[m.id,m])).values()]);
  openRouterEnabledCount = computed(() => this.allOpenRouterModels().filter(m=>!this.modelBlacklist().includes(m.id)).length);
  filteredOpenRouterModels = computed(() => this.allOpenRouterModels().filter(m=>{
    const q=this.providerModelSearch().toLowerCase().trim(), filter=this.providerModelFilter(), enabled=!this.modelBlacklist().includes(m.id);
    return (!q||m.label.toLowerCase().includes(q)||m.id.toLowerCase().includes(q))&&(filter==='all'||(filter==='enabled'?enabled:!enabled));
  }));
  allCerebrasModels = computed(() => [...new Map(this.accounts().filter(a=>a.provider==='cerebras').flatMap(a=>a.models || []).filter(m=>m.id!=='default').map(m=>[m.id,m])).values()]);
  cerebrasEnabledCount = computed(() => this.allCerebrasModels().filter(m=>!this.modelBlacklist().includes(m.id)).length);
  filteredCerebrasModels = computed(() => this.allCerebrasModels().filter(m=>{
    const q=this.providerModelSearch().toLowerCase().trim(), filter=this.providerModelFilter(), enabled=!this.modelBlacklist().includes(m.id);
    return (!q||m.label.toLowerCase().includes(q)||m.id.toLowerCase().includes(q))&&(filter==='all'||(filter==='enabled'?enabled:!enabled));
  }));
  disabledModelsCount = computed(() => this.modelBlacklist().length);
  geminiEnabledCount = computed(() => {
    const blacklist = new Set(this.modelBlacklist());
    return this.allGeminiModels().filter((m) => !blacklist.has(m.id)).length;
  });
  codexEnabledCount = computed(() => {
    const blacklist = new Set(this.modelBlacklist());
    return this.allCodexModels().filter((m) => !blacklist.has(m.id)).length;
  });
  chatgptEnabledCount = computed(() => {
    const blacklist = new Set(this.modelBlacklist());
    return this.allChatGPTModels().filter((m) => !blacklist.has(m.id)).length;
  });
  totalModelsCount = computed(
    () =>
      this.allGeminiModels().length + this.allCodexModels().length + this.allChatGPTModels().length + this.allOpenRouterModels().length + this.allCerebrasModels().length,
  );
  totalEnabledCount = computed(
    () => this.geminiEnabledCount() + this.codexEnabledCount() + this.chatgptEnabledCount() + this.openRouterEnabledCount() + this.cerebrasEnabledCount(),
  );
  providerModelSearch = signal('');
  providerModelFilter = signal<'all' | 'enabled' | 'disabled'>('all');
  filteredGeminiModels = computed(() => {
    const q = this.providerModelSearch().toLowerCase().trim();
    const filter = this.providerModelFilter();
    const blacklist = new Set(this.modelBlacklist());
    return this.allGeminiModels().filter((m) => {
      const matchesQuery =
        !q || m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
      if (!matchesQuery) return false;
      const isEnabled = !blacklist.has(m.id);
      if (filter === 'enabled') return isEnabled;
      if (filter === 'disabled') return !isEnabled;
      return true;
    });
  });
  filteredCodexModels = computed(() => {
    const q = this.providerModelSearch().toLowerCase().trim();
    const filter = this.providerModelFilter();
    const blacklist = new Set(this.modelBlacklist());
    return this.allCodexModels().filter((m) => {
      const matchesQuery =
        !q || m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
      if (!matchesQuery) return false;
      const isEnabled = !blacklist.has(m.id);
      if (filter === 'enabled') return isEnabled;
      if (filter === 'disabled') return !isEnabled;
      return true;
    });
  });
  filteredChatGPTModels = computed(() => {
    const q = this.providerModelSearch().toLowerCase().trim();
    const filter = this.providerModelFilter();
    const blacklist = new Set(this.modelBlacklist());
    return this.allChatGPTModels().filter((m) => {
      const matchesQuery =
        !q || m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
      if (!matchesQuery) return false;
      const isEnabled = !blacklist.has(m.id);
      if (filter === 'enabled') return isEnabled;
      if (filter === 'disabled') return !isEnabled;
      return true;
    });
  });
  isModelEnabled(id: string): boolean {
    return !this.modelBlacklist().includes(id);
  }
  async toggleModel(id: string, enable?: boolean) {
    const current = this.modelBlacklist();
    const isCurrentlyEnabled = !current.includes(id);
    const shouldEnable = enable !== undefined ? enable : !isCurrentlyEnabled;
    let updated: string[];
    if (shouldEnable) {
      updated = current.filter((mId) => mId !== id);
    } else {
      updated = current.includes(id) ? current : [...current, id];
    }
    await this.saveBlacklist(updated);
  }
  async enableAllModels() {
    await this.saveBlacklist([]);
  }
  async disableAllModels() {
    const allIds = [
      ...this.allGeminiModels().map((m) => m.id),
      ...this.allCodexModels().map((m) => m.id),
      ...this.allChatGPTModels().map((m) => m.id),
      ...this.allOpenRouterModels().map(m=>m.id),
      ...this.allCerebrasModels().map(m=>m.id),
    ];
    await this.saveBlacklist(Array.from(new Set(allIds)));
  }
  async enableAllForProvider(provider: ProviderId) {
    const models =
      provider === 'cerebras' ? this.allCerebrasModels() : provider === 'openrouter' ? this.allOpenRouterModels() : provider === 'antigravity'
        ? this.allGeminiModels()
        : provider === 'codex'
          ? this.allCodexModels()
          : this.allChatGPTModels();
    const idsToRemove = new Set(models.map((m) => m.id));
    const updated = this.modelBlacklist().filter((id) => !idsToRemove.has(id));
    await this.saveBlacklist(updated);
  }
  async disableAllForProvider(provider: ProviderId) {
    const models =
      provider === 'cerebras' ? this.allCerebrasModels() : provider === 'openrouter' ? this.allOpenRouterModels() : provider === 'antigravity'
        ? this.allGeminiModels()
        : provider === 'codex'
          ? this.allCodexModels()
          : this.allChatGPTModels();
    const idsToAdd = models.map((m) => m.id);
    const updated = Array.from(new Set([...this.modelBlacklist(), ...idsToAdd]));
    await this.saveBlacklist(updated);
  }
  async saveBlacklist(list: string[]) {
    const previous = this.modelBlacklist();
    this.modelBlacklist.set(list);
    if (list.includes(this.selectedModel())) {
      this.selectedModel.set('default');
      this.validateReasoning();
    }
    try {
      const res = await this.http.request<{ ok: boolean; blacklist: string[] }>(
        '/user/model-blacklist',
        {
          method: 'PUT',
          body: JSON.stringify({ blacklist: list }),
        },
      );
      if (res?.blacklist) {
        this.modelBlacklist.set(res.blacklist);
      }
    } catch (e) {
      this.modelBlacklist.set(previous);
      this.error.set((e as Error).message);
    }
  }
  async refreshProviders() {
    try {
      const [res, refresh] = await Promise.all([
        this.http.request<{ blacklist: string[] }>('/user/model-blacklist'),
        this.http.request<{ requested: number }>('/providers/refresh', { method: 'POST' }),
      ]);
      if (res?.blacklist) this.modelBlacklist.set(res.blacklist);
      await this.refreshAccounts();
      this.notice.set(
        refresh.requested
          ? 'Model update launched'
          : 'There are no connected runners to update models',
      );
    } catch (e) {
      if (this.page() === 'providers') this.error.set((e as Error).message);
    }
  }
  reasoningOptions = computed(() => {
    const modelId = this.selectedModel();
    const currentModel =
      this.models().find((m) => m.id === modelId) ||
      this.allGeminiModels().find((m) => m.id === modelId) ||
      this.allCodexModels().find((m) => m.id === modelId) ||
      this.allChatGPTModels().find((m) => m.id === modelId) || this.allOpenRouterModels().find(m=>m.id===modelId) || this.allCerebrasModels().find(m=>m.id===modelId);
    const options = currentModel?.reasoning;
    if (options && options.length > 0) {
      return [{ id: 'default', label: 'Default' }, ...options.filter((r) => r.id !== 'default')];
    }
    if (modelId !== 'default' && this.selectedService() === 'codex') {
      return [
        { id: 'default', label: 'Default' },
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' },
        { id: 'xhigh', label: 'Extra high (XHigh)' },
      ];
    }
    if (modelId === 'default') {
      return [
        { id: 'default', label: 'Default' },
        { id: 'high', label: 'High' },
        { id: 'medium', label: 'Medium' },
        { id: 'low', label: 'Low' },
        ...(this.selectedService() === 'codex'
          ? [{ id: 'xhigh', label: 'Extra high (XHigh)' }]
          : []),
      ];
    }
    return [];
  });
  onReasoningChange(val: string) {
    this.selectedReasoning.set(val);
    this.validateReasoning();
  }
  hasAccountsFor(service: ServiceId): boolean {
    const accounts = Array.isArray(this.accounts()) ? this.accounts() : [];
    if (service === 'auto') return accounts.length > 0;
    const provider: ProviderId =
      service === 'cerebras' ? 'cerebras' : service === 'openrouter' ? 'openrouter' : service === 'gemini' ? 'antigravity' : service === 'codex' ? 'codex' : 'chatgpt';
    const pId = this.current()?.projectId || this.selectedProjectId();
    const project = pId ? this.projects().find((p) => p.id === pId) : null;
    const list =
      project && !project.shared
        ? accounts.filter((a) => a.runnerId === project.runnerId)
        : accounts;
    return list.some((a) => a.provider === provider);
  }
  selectTaskProject(id: string) {
    this.selectedProjectId.set(id);
    this.selectService(this.selectedService());
  }
  selectService(service: ServiceId) {
    this.selectedService.set(service);
    this.selectedAccount = service;
    const available = this.models();
    if (!available.some((m) => m.id === this.selectedModel())) this.selectedModel.set('default');
    this.validateReasoning();
  }
  selectAccount(id: string) {
    this.selectedAccount = id;
    this.selectedModel.set('default');
    this.selectedReasoning.set('default');
  }
  selectModel(id: string) {
    this.selectedModel.set(id);
    if (id !== 'default' && !(this.selectedService() === 'cerebras' && this.models().some(m => m.id === id))) {
      const isGemini = this.allGeminiModels().some((m) => m.id === id);
      const isCodex = this.allCodexModels().some((m) => m.id === id);
      const isChatGPT = this.allChatGPTModels().some((m) => m.id === id);
      if (isGemini) {
        this.selectedService.set('gemini');
        this.selectedAccount = 'gemini';
      } else if (isCodex) {
        this.selectedService.set('codex');
        this.selectedAccount = 'codex';
      } else if (this.allCerebrasModels().some(m=>m.id===id)) {
        this.selectedService.set('cerebras');this.selectedAccount='cerebras';
      } else if (this.allOpenRouterModels().some(m=>m.id===id)) {
        this.selectedService.set('openrouter');this.selectedAccount='openrouter';
      } else if (isChatGPT) {
        this.selectedService.set('chatgpt');
        this.selectedAccount = 'chatgpt';
      }
    }
    const currentModel =
      this.models().find((m) => m.id === id) ||
      this.allGeminiModels().find((m) => m.id === id) ||
      this.allCodexModels().find((m) => m.id === id) ||
      this.allChatGPTModels().find((m) => m.id === id) || this.allOpenRouterModels().find(m=>m.id===id) || this.allCerebrasModels().find(m=>m.id===id);
    if (
      currentModel?.defaultReasoning &&
      (!this.selectedReasoning() || this.selectedReasoning() === 'default')
    ) {
      this.selectedReasoning.set(currentModel.defaultReasoning);
    }
    this.validateReasoning();
  }
  validateReasoning() {
    const modelId = this.selectedModel();
    const currentModel =
      this.models().find((m) => m.id === modelId) ||
      this.allGeminiModels().find((m) => m.id === modelId) ||
      this.allCodexModels().find((m) => m.id === modelId) ||
      this.allChatGPTModels().find((m) => m.id === modelId) || this.allOpenRouterModels().find(m=>m.id===modelId) || this.allCerebrasModels().find(m=>m.id===modelId);
    const reasoningExists = currentModel?.reasoning?.some((r) => r.id === this.selectedReasoning());
    if (
      modelId !== 'default' &&
      this.selectedReasoning() !== 'default' &&
      currentModel?.reasoning?.length &&
      !reasoningExists
    ) {
      this.selectedReasoning.set(currentModel?.defaultReasoning || 'default');
    }
  }
}
