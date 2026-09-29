import { Component, OnInit, AfterViewInit, OnDestroy, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { io, Socket } from 'socket.io-client';
import {
  LucideArrowUp, LucideArrowUpRight, LucideBell, LucideBookOpen, LucideBot, LucideCheck,
  LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideCircleQuestionMark, LucideCompass,
  LucideCopy, LucideDownload, LucideEllipsis, LucideFile, LucideFolder, LucideFolderOpen, LucideGlobe2,
  LucideGraduationCap, LucideHouse, LucideInfo, LucideLibrary, LucideLogOut, LucideMenu, LucideMessageSquare,
  LucideMic, LucideMicOff, LucideOrigami, LucidePanelLeft,
  LucidePlugZap, LucidePlus, LucideRefreshCw, LucideRotateCcw,
  LucideSearch, LucideServer, LucideSettings2, LucideSparkles, LucideSquare, LucideSquarePen, LucideTerminal, LucideUploadCloud, LucideX, LucideZap
} from '@lucide/angular';
import { ManagerPanel } from './manager-panel';
import { MarkdownPipe } from './markdown.pipe';

type ProviderId = 'codex' | 'antigravity' | 'chatgpt';
export type ServiceId = 'auto' | 'gemini' | 'codex' | 'chatgpt';
type ReasoningEffort = {id:string;label:string};
type Model = {id:string;label:string;reasoning?:ReasoningEffort[];defaultReasoning?:string};

export const DEFAULT_CODEX_MODELS: Model[] = [
  { id: 'default', label: 'По умолчанию Codex' }
];

export const DEFAULT_GEMINI_MODELS: Model[] = [
  { id: 'default', label: 'По умолчанию Gemini' }
];

export const DEFAULT_CHATGPT_MODELS: Model[] = [
  { id: 'default', label: 'По умолчанию ChatGPT' }
];
type UsageWindow = {usedPercent:number;remainingPercent:number;windowMinutes:number|null;resetAt:string|null};
type Account = {id:string;provider:ProviderId;name:string;runnerId?:string;priority?:0|1|2;authType?:'api_key';models:Model[];mode:'runner'|'offline'|'unassigned';auth:string;detail:string;limit:{source:'provider'|'unknown';primary:UsageWindow|null;secondary:UsageWindow|null;cooldownUntil:string|null;updatedAt:string|null}};
type Runner = {id:string;name:string;online:boolean;managementOnline:boolean;createdAt:string;revokedAt?:string};
type Project = {id:string;name:string;runnerId:string;createdAt:string;updatedAt:string};
type Preview = {subdomain:string;runnerId:string;visible:boolean;online:boolean;expired:boolean;url:string;createdAt:string;updatedAt:string;expiresAt:string};
type Pairing = {code:string;expiresAt:string};
type Message = {id:string;role:'user'|'assistant'|'system';text:string;at?:string;provider?:ProviderId|string;steps?:any[];[key:string]:any};
type ChatSession = {id:string;title:string;updatedAt:string;messages:Message[];projectId?:string};

export function getSessionLastMessageTime(sess: ChatSession): number {
  if (sess.messages && sess.messages.length > 0) {
    for (let i = sess.messages.length - 1; i >= 0; i--) {
      const at = sess.messages[i]?.at;
      if (at) {
        const t = new Date(at).getTime();
        if (!isNaN(t) && t > 0) return t;
      }
    }
  }
  const fallback = new Date(sess.updatedAt || 0).getTime();
  return isNaN(fallback) ? 0 : fallback;
}

export function sortSessions(list: ChatSession[]): ChatSession[] {
  return [...list]
    .filter(s => !!s && Array.isArray(s.messages) && s.messages.length > 0)
    .sort((a, b) => getSessionLastMessageTime(b) - getSessionLastMessageTime(a));
}
type AIEvent = {id:string;sessionId:string;runId:string;type:string;provider?:ProviderId;message?:string;text?:string;data?:{accountId?:string;state?:string}};
type RunActivity = {type:string;message:string;at:string;provider?:ProviderId;accountId?:string};
type RunState = {runId:string;sessionId:string;startedAt:string;accountId?:string;provider?:ProviderId;message:string;stream:string;activity:RunActivity[]} | {runId:string;sessionId:string;type:'completed'|'error';message:string;finishedAt:number};

export interface FlatFileNode {
  name: string;
  path: string;
  isDir: boolean;
  depth: number;
  size: number;
  modified?: string;
  fileCount?: number;
  isExpanded?: boolean;
}

interface FileNodeInternal {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified?: string;
  fileCount: number;
  children: Map<string, FileNodeInternal>;
}

@Component({
  selector:'app-root',
  standalone:true,
  imports:[
    CommonModule, FormsModule, LucideArrowUp, LucideArrowUpRight, LucideBookOpen, LucideBot, LucideCheck,
    LucideChevronDown, LucideChevronRight, LucideCircleQuestionMark, LucideCompass, LucideCopy, LucideDownload, LucideEllipsis,
    LucideFile, LucideFolder, LucideFolderOpen, LucideGlobe2, LucideGraduationCap, LucideHouse, LucideInfo, LucideLibrary, LucideLogOut, LucideMenu,
    LucideMessageSquare, LucideMic, LucideMicOff, LucideOrigami, LucidePanelLeft, LucidePlugZap, LucidePlus,
    LucideRefreshCw, LucideRotateCcw, LucideSearch, LucideServer, LucideSettings2, LucideSparkles, LucideSquare, LucideSquarePen, LucideTerminal, LucideUploadCloud, LucideX,
    LucideZap, ManagerPanel, MarkdownPipe
  ],
  templateUrl:'./app.html',
  styleUrl:'./app.css'
})
export class App implements OnInit,AfterViewInit,OnDestroy {
  username=''; password=''; loginName=''; loginError=''; registerMode=signal(false);
  loggedIn=signal(false); page=signal<'chat'|'projects'|'sites'|'providers'|'connections'|'runners'|'users'>('chat');
  isOwner=signal(false);
  users=signal<{id:string;username:string;createdAt:string}[]>([]);
  newUsername=''; newUserPassword=''; userAdminError=''; userAdminNotice='';
  mobileMenu=signal(false);
  managedRunner=signal<Runner|null>(null);
  modelBlacklist=signal<string[]>([]);
  accounts=signal<Account[]>([]); runners=signal<Runner[]>([]); projects=signal<Project[]>([]); previews=signal<Preview[]>([]); selectedProjectId=signal(''); pairing=signal<Pairing|null>(null); sessions=signal<ChatSession[]>([]); current=signal<ChatSession|null>(null);
  sidebarOpen = signal(true);
  mode = signal<'chat'|'work'>('chat');
  expandedProjects = signal<Set<string>>(new Set(['CCC-Solutions', 'Quest Control', 'proj-ccc', 'proj-quest']));
  moreMenuOpen = signal(false);
  userMenuOpen = signal(false);
  helpModalOpen = signal(false);
  modelMenuOpen = signal(false);
  searchOpen = signal(false);
  sidebarSearch = signal('');
  isDemo = false;
  currentServiceLabel = computed(() => {
    if (this.mode() === 'chat') return 'ChatGPT';
    const s = this.selectedService();
    if (s === 'gemini') return 'Gemini';
    if (s === 'codex') return 'Codex';
    if (s === 'chatgpt') return 'ChatGPT';
    return 'Auto';
  });
  currentModelBadgeLabel = computed(() => {
    const modelId = this.selectedModel();
    if (modelId === 'default') {
      const s = this.selectedService();
      if (this.mode() === 'chat' || s === 'chatgpt') return 'ChatGPT';
      if (s === 'gemini') return 'Gemini';
      if (s === 'codex') return 'Codex';
      return 'Модель';
    }
    const m = this.models().find(item => item.id === modelId)
           || this.allGeminiModels().find(item => item.id === modelId)
           || this.allCodexModels().find(item => item.id === modelId)
           || this.allChatGPTModels().find(item => item.id === modelId);
    if (!m) return modelId;
    return m.label.replace(/\s*·\s*(Gemini|Codex|ChatGPT)$/, '');
  });
  currentReasoningBadgeLabel = computed(() => {
    const r = this.selectedReasoning();
    const modelId = this.selectedModel();
    if (!r || r === 'default') {
      const currentModel = this.models().find(m => m.id === modelId)
                        || this.allGeminiModels().find(m => m.id === modelId)
                        || this.allCodexModels().find(m => m.id === modelId)
                        || this.allChatGPTModels().find(m => m.id === modelId);
      if (currentModel?.defaultReasoning) {
        const opt = currentModel.reasoning?.find((o: ReasoningEffort) => o.id === currentModel.defaultReasoning);
        if (opt) return opt.label;
      }
      return 'Reasoning';
    }
    const opt = this.reasoningOptions().find(o => o.id === r);
    if (opt && opt.id !== 'default') return opt.label;
    if (r === 'high') return 'Высокое';
    if (r === 'medium') return 'Среднее';
    if (r === 'low') return 'Низкое';
    if (r === 'max') return 'Макс';
    return r.charAt(0).toUpperCase() + r.slice(1);
  });
  currentReasoningOrModelLabel = computed(() => this.currentReasoningBadgeLabel());
  draft=''; selectedService=signal<ServiceId>('chatgpt'); selectedAccount='chatgpt'; selectedModel=signal<string>('default'); selectedReasoning=signal<string>('default'); codexFast=signal(false);
  handoffLoading=signal(false);
  slashCommands=[
    { cmd: '/codex', label: 'Передать в Codex', desc: 'git diff + ключевые пункты задачи', target: 'codex' as const },
    { cmd: '/chatgpt', label: 'Обсудить с ChatGPT', desc: 'git diff + ключевые пункты задачи', target: 'chatgpt' as const }
  ];
  get filteredSlashCommands(){
    const d=this.draft.trim().toLowerCase();
    if(!d.startsWith('/')||d.includes(' '))return [];
    if(d==='/')return this.slashCommands;
    return this.slashCommands.filter(c=>c.cmd.startsWith(d));
  }
  accountName=''; accountProvider:ProviderId|'openai-api'='codex'; apiKeyDrafts:Record<string,string>={}; savingApiKey=signal(''); deletingAccount=signal(''); addingAccount=signal(false); selectedRunner=''; runnerName='Мой компьютер'; notice=signal(''); error=signal('');
  running=signal(false); uploading=signal(false); runId=signal(''); stream=signal(''); activeAccount=signal(''); activeProvider=signal<ProviderId|undefined>(undefined); activity=signal<RunActivity[]>([]); runStartedAt=signal(''); now=signal(Date.now());
  socket?:Socket;
  private clock?:ReturnType<typeof setInterval>;
  copiedId=signal<string>('');
  taskFiles=signal<{name:string;size:number;modified:string}[]>([]);
  sharedFileLinks=signal<Record<string,string>>({});
  filesOpen=signal(false); filesLoading=signal(false);
  collapsedDirs=signal<Set<string>>(new Set());
  filesFilter=signal<string>('');
  isDraggingOver = signal(false);
  private dragCounter = 0;

  isRecording = signal(false);
  speechSupported = signal(false);
  voiceLang = signal<'ru-RU' | 'en-US'>('ru-RU');
  private recognition: any = null;
  private recordingBaseText = '';
  @ViewChild('composerTextarea') composerTextareaRef?: ElementRef<HTMLTextAreaElement>;

  userScrolledUp = signal(false);
  showScrollBottom = signal(false);
  @ViewChild('chatScrollArea') chatScrollArea?: ElementRef<HTMLDivElement>;
  @ViewChild('messageFeed') messageFeed?: ElementRef<HTMLDivElement>;
  private scrollRaf?: number;
  private resizeObserver?: ResizeObserver;
  private isProgrammaticScroll = false;
  private isSmoothScrollingToBottom = false;
  private smoothScrollTimeout?: ReturnType<typeof setTimeout>;
  private lastScrollTop = 0;
  private onViewportResize = () => {
    if (!this.userScrolledUp()) this.requestScrollToBottom();
  };

  ngAfterViewInit() {
    this.setupResizeObserver();
    this.scrollToBottom(true, 'auto');
  }

  private setupResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    const container = this.chatScrollArea?.nativeElement;
    const feed = this.messageFeed?.nativeElement;
    if (!container) return;

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.userScrolledUp()) {
        this.scrollToBottom(false, 'auto');
      }
    });

    this.resizeObserver.observe(container);
    if (feed) {
      this.resizeObserver.observe(feed);
    }
  }

  private cleanupResizeObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
  }

  ensureChatScrollAttached(forceScroll = false) {
    this.userScrolledUp.set(false);
    this.showScrollBottom.set(false);
    this.isSmoothScrollingToBottom = false;
    setTimeout(() => {
      this.setupResizeObserver();
      if (forceScroll) {
        this.scrollToBottom(true, 'auto');
      }
    }, 0);
  }

  onChatScroll() {
    const el = this.chatScrollArea?.nativeElement;
    if (!el) return;

    const currentScrollTop = el.scrollTop;
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const distanceFromBottom = Math.max(0, scrollHeight - currentScrollTop - clientHeight);

    if (this.isProgrammaticScroll) {
      this.lastScrollTop = currentScrollTop;
      return;
    }

    if (this.isSmoothScrollingToBottom) {
      if (distanceFromBottom <= 40) {
        this.isSmoothScrollingToBottom = false;
        if (this.smoothScrollTimeout) {
          clearTimeout(this.smoothScrollTimeout);
          this.smoothScrollTimeout = undefined;
        }
      }
      this.lastScrollTop = currentScrollTop;
      return;
    }

    const scrollDelta = currentScrollTop - this.lastScrollTop;
    this.lastScrollTop = currentScrollTop;

    if (distanceFromBottom <= 40) {
      if (this.userScrolledUp()) this.userScrolledUp.set(false);
      if (this.showScrollBottom()) this.showScrollBottom.set(false);
    } else if (scrollDelta < -2 && distanceFromBottom > 25) {
      // User actively scrolled UP
      if (!this.userScrolledUp()) this.userScrolledUp.set(true);
      if (!this.showScrollBottom()) this.showScrollBottom.set(true);
    } else if (distanceFromBottom > 100) {
      // Significantly away from bottom
      if (!this.userScrolledUp()) this.userScrolledUp.set(true);
      if (!this.showScrollBottom()) this.showScrollBottom.set(true);
    }
  }

  scrollToBottom(force = false, behavior: ScrollBehavior = 'auto') {
    if (!force && this.userScrolledUp()) {
      return;
    }
    const el = this.chatScrollArea?.nativeElement;
    if (!el) return;

    if (force) {
      this.userScrolledUp.set(false);
      this.showScrollBottom.set(false);
    }

    if (behavior === 'smooth') {
      this.isSmoothScrollingToBottom = true;
      if (this.smoothScrollTimeout) clearTimeout(this.smoothScrollTimeout);
      this.smoothScrollTimeout = setTimeout(() => {
        this.isSmoothScrollingToBottom = false;
      }, 800);
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      this.isProgrammaticScroll = true;
      el.scrollTop = el.scrollHeight;
      this.lastScrollTop = el.scrollTop;
      requestAnimationFrame(() => {
        this.isProgrammaticScroll = false;
        if (el) this.lastScrollTop = el.scrollTop;
      });
    }
  }

  requestScrollToBottom(force = false, behavior: ScrollBehavior = 'auto') {
    if (force) {
      this.userScrolledUp.set(false);
      this.showScrollBottom.set(false);
    } else if (this.userScrolledUp()) {
      return;
    }
    if (this.scrollRaf) {
      cancelAnimationFrame(this.scrollRaf);
    }
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = undefined;
      this.scrollToBottom(force, behavior);
    });
  }

  currentProject=computed(()=>{const pId=this.current()?.projectId;return pId?this.projects().find(p=>p.id===pId):null;});
  chatgptModelNotice=computed(()=>{
    if(this.mode()!=='chat' || this.isDemo || this.models().some(m=>m.id!=='default'))return '';
    const accounts=(Array.isArray(this.accounts()) ? this.accounts() : []).filter(a=>a.provider==='chatgpt');
    if(!accounts.length)return 'Подключите аккаунт ChatGPT, чтобы загрузить модели.';
    const error=accounts.find(a=>a.detail.startsWith('Ошибка подключения:'));
    if(error)return error.detail;
    if(accounts.every(a=>a.mode!=='runner'))return 'Runner ChatGPT не подключён. Модели появятся после подключения.';
    return 'Список моделей ChatGPT пока не загружен. Проверьте сессию и настройку MOCK_MODE на runner.';
  });
  models=computed(()=>{
    const blacklist=new Set(this.modelBlacklist());
    const allAccounts=Array.isArray(this.accounts()) ? this.accounts() : [];
    const pId=this.current()?.projectId;
    const project=pId?this.projects().find(p=>p.id===pId):null;
    const scoped=project?allAccounts.filter(a=>a.runnerId===project.runnerId):allAccounts;

    if(this.mode() === 'chat'){
      const accModels=scoped.filter(a=>a.provider==='chatgpt').flatMap(a=>a.models||[]);
      const map=new Map<string,Model>();
      for(const m of DEFAULT_CHATGPT_MODELS)map.set(m.id,{...m});
      for(const m of accModels)if(m.id!=='default')map.set(m.id,m);
      map.set('default',{id:'default',label:'По умолчанию ChatGPT'});
      return [...map.values()].filter(m=>m.id==='default'||!blacklist.has(m.id));
    }

    const service=this.selectedService();

    if(service==='gemini'){
      const accModels=scoped.filter(a=>a.provider==='antigravity').flatMap(a=>a.models||[]);
      const map=new Map<string,Model>();
      for(const m of DEFAULT_GEMINI_MODELS)map.set(m.id,{...m});
      for(const m of accModels)if(m.id!=='default')map.set(m.id,m);
      map.set('default',{id:'default',label:'По умолчанию Gemini'});
      return [...map.values()].filter(m=>m.id==='default'||!blacklist.has(m.id));
    }

    if(service==='codex'){
      const accModels=scoped.filter(a=>a.provider==='codex').flatMap(a=>a.models||[]);
      const map=new Map<string,Model>();
      for(const m of DEFAULT_CODEX_MODELS)map.set(m.id,{...m});
      for(const m of accModels)if(m.id!=='default')map.set(m.id,m);
      map.set('default',{id:'default',label:'По умолчанию Codex'});
      return [...map.values()].filter(m=>m.id==='default'||!blacklist.has(m.id));
    }

    if(service==='chatgpt'){
      const accModels=scoped.filter(a=>a.provider==='chatgpt').flatMap(a=>a.models||[]);
      const map=new Map<string,Model>();
      for(const m of DEFAULT_CHATGPT_MODELS)map.set(m.id,{...m});
      for(const m of accModels)if(m.id!=='default')map.set(m.id,m);
      map.set('default',{id:'default',label:'По умолчанию ChatGPT'});
      return [...map.values()].filter(m=>m.id==='default'||!blacklist.has(m.id));
    }

    const map=new Map<string,Model>();
    map.set('default',{id:'default',label:'По умолчанию (Auto)'});
    for(const m of DEFAULT_GEMINI_MODELS)if(m.id!=='default')map.set(m.id,{...m,label:`${m.label} · Gemini`});
    for(const a of scoped.filter(x=>x.provider==='antigravity')){
      for(const m of a.models||[])if(m.id!=='default'&&!map.has(m.id))map.set(m.id,{...m,label:`${m.label} · Gemini`});
    }
    for(const m of DEFAULT_CODEX_MODELS)if(m.id!=='default')map.set(m.id,{...m,label:`${m.label} · Codex`});
    for(const a of scoped.filter(x=>x.provider==='codex')){
      for(const m of a.models||[])if(m.id!=='default'&&!map.has(m.id))map.set(m.id,{...m,label:`${m.label} · Codex`});
    }
    for(const m of DEFAULT_CHATGPT_MODELS)if(m.id!=='default')map.set(m.id,{...m,label:`${m.label} · ChatGPT`});
    for(const a of scoped.filter(x=>x.provider==='chatgpt')){
      for(const m of a.models||[])if(m.id!=='default'&&!map.has(m.id))map.set(m.id,{...m,label:`${m.label} · ChatGPT`});
    }
    return [...map.values()].filter(m=>m.id==='default'||!blacklist.has(m.id));
  });

  allGeminiModels=computed(()=>{
    const accounts=Array.isArray(this.accounts()) ? this.accounts() : [];
    const accModels=accounts.filter(a=>a.provider==='antigravity').flatMap(a=>a.models||[]);
    const map=new Map<string,Model>();
    for(const m of DEFAULT_GEMINI_MODELS)if(m.id!=='default')map.set(m.id,{...m});
    for(const m of accModels)if(m.id!=='default'&&!map.has(m.id))map.set(m.id,m);
    return [...map.values()];
  });

  allCodexModels=computed(()=>{
    const accounts=Array.isArray(this.accounts()) ? this.accounts() : [];
    const accModels=accounts.filter(a=>a.provider==='codex').flatMap(a=>a.models||[]);
    const map=new Map<string,Model>();
    for(const m of DEFAULT_CODEX_MODELS)if(m.id!=='default')map.set(m.id,{...m});
    for(const m of accModels)if(m.id!=='default'&&!map.has(m.id))map.set(m.id,m);
    return [...map.values()];
  });

  allChatGPTModels=computed(()=>{
    const accounts=Array.isArray(this.accounts()) ? this.accounts() : [];
    const accModels=accounts.filter(a=>a.provider==='chatgpt').flatMap(a=>a.models||[]);
    const map=new Map<string,Model>();
    for(const m of DEFAULT_CHATGPT_MODELS)if(m.id!=='default')map.set(m.id,{...m});
    for(const m of accModels)if(m.id!=='default'&&!map.has(m.id))map.set(m.id,m);
    return [...map.values()];
  });

  disabledModelsCount=computed(()=>this.modelBlacklist().length);

  geminiEnabledCount=computed(()=>{
    const blacklist=new Set(this.modelBlacklist());
    return this.allGeminiModels().filter(m=>!blacklist.has(m.id)).length;
  });

  codexEnabledCount=computed(()=>{
    const blacklist=new Set(this.modelBlacklist());
    return this.allCodexModels().filter(m=>!blacklist.has(m.id)).length;
  });

  chatgptEnabledCount=computed(()=>{
    const blacklist=new Set(this.modelBlacklist());
    return this.allChatGPTModels().filter(m=>!blacklist.has(m.id)).length;
  });

  totalModelsCount=computed(()=>this.allGeminiModels().length+this.allCodexModels().length+this.allChatGPTModels().length);
  totalEnabledCount=computed(()=>this.geminiEnabledCount()+this.codexEnabledCount()+this.chatgptEnabledCount());
  providerModelSearch=signal('');
  providerModelFilter=signal<'all'|'enabled'|'disabled'>('all');

  filteredGeminiModels=computed(()=>{
    const q=this.providerModelSearch().toLowerCase().trim();
    const filter=this.providerModelFilter();
    const blacklist=new Set(this.modelBlacklist());
    return this.allGeminiModels().filter(m=>{
      const matchesQuery=!q||m.label.toLowerCase().includes(q)||m.id.toLowerCase().includes(q);
      if(!matchesQuery)return false;
      const isEnabled=!blacklist.has(m.id);
      if(filter==='enabled')return isEnabled;
      if(filter==='disabled')return !isEnabled;
      return true;
    });
  });

  filteredCodexModels=computed(()=>{
    const q=this.providerModelSearch().toLowerCase().trim();
    const filter=this.providerModelFilter();
    const blacklist=new Set(this.modelBlacklist());
    return this.allCodexModels().filter(m=>{
      const matchesQuery=!q||m.label.toLowerCase().includes(q)||m.id.toLowerCase().includes(q);
      if(!matchesQuery)return false;
      const isEnabled=!blacklist.has(m.id);
      if(filter==='enabled')return isEnabled;
      if(filter==='disabled')return !isEnabled;
      return true;
    });
  });

  filteredChatGPTModels=computed(()=>{
    const q=this.providerModelSearch().toLowerCase().trim();
    const filter=this.providerModelFilter();
    const blacklist=new Set(this.modelBlacklist());
    return this.allChatGPTModels().filter(m=>{
      const matchesQuery=!q||m.label.toLowerCase().includes(q)||m.id.toLowerCase().includes(q);
      if(!matchesQuery)return false;
      const isEnabled=!blacklist.has(m.id);
      if(filter==='enabled')return isEnabled;
      if(filter==='disabled')return !isEnabled;
      return true;
    });
  });

  isModelEnabled(id:string):boolean{
    return !this.modelBlacklist().includes(id);
  }

  async toggleModel(id:string,enable?:boolean){
    const current=this.modelBlacklist();
    const isCurrentlyEnabled=!current.includes(id);
    const shouldEnable=enable!==undefined?enable:!isCurrentlyEnabled;
    let updated:string[];
    if(shouldEnable){
      updated=current.filter(mId=>mId!==id);
    }else{
      updated=current.includes(id)?current:[...current,id];
    }
    await this.saveBlacklist(updated);
  }

  async enableAllModels(){
    await this.saveBlacklist([]);
  }

  async disableAllModels(){
    const allIds=[...this.allGeminiModels().map(m=>m.id),...this.allCodexModels().map(m=>m.id),...this.allChatGPTModels().map(m=>m.id)];
    await this.saveBlacklist(Array.from(new Set(allIds)));
  }

  async enableAllForProvider(provider:ProviderId){
    const models=provider==='antigravity'?this.allGeminiModels():provider==='codex'?this.allCodexModels():this.allChatGPTModels();
    const idsToRemove=new Set(models.map(m=>m.id));
    const updated=this.modelBlacklist().filter(id=>!idsToRemove.has(id));
    await this.saveBlacklist(updated);
  }

  async disableAllForProvider(provider:ProviderId){
    const models=provider==='antigravity'?this.allGeminiModels():provider==='codex'?this.allCodexModels():this.allChatGPTModels();
    const idsToAdd=models.map(m=>m.id);
    const updated=Array.from(new Set([...this.modelBlacklist(),...idsToAdd]));
    await this.saveBlacklist(updated);
  }

  async saveBlacklist(list:string[]){
    const previous=this.modelBlacklist();
    this.modelBlacklist.set(list);
    if(list.includes(this.selectedModel())){
      this.selectedModel.set('default');
      this.validateReasoning();
    }
    try{
      const res=await this.api<{ok:boolean;blacklist:string[]}>('/user/model-blacklist',{
        method:'PUT',
        body:JSON.stringify({blacklist:list})
      });
      if(res?.blacklist){
        this.modelBlacklist.set(res.blacklist);
      }
    }catch(e){
      this.modelBlacklist.set(previous);
      this.error.set((e as Error).message);
    }
  }

  async refreshProviders(){
    try{
      const [res,refresh]=await Promise.all([
        this.api<{blacklist:string[]}>('/user/model-blacklist'),
        this.api<{requested:number}>('/providers/refresh',{method:'POST'})
      ]);
      if(res?.blacklist)this.modelBlacklist.set(res.blacklist);
      await this.refreshAccounts();
      this.notice.set(refresh.requested?'Обновление моделей запущено':'Нет подключённых runner для обновления моделей');
    }catch(e){
      if(this.page()==='providers')this.error.set((e as Error).message);
    }
  }

  reasoningOptions = computed(() => {
    const modelId = this.selectedModel();
    const currentModel = this.models().find(m => m.id === modelId)
                      || this.allGeminiModels().find(m => m.id === modelId)
                      || this.allCodexModels().find(m => m.id === modelId)
                      || this.allChatGPTModels().find(m => m.id === modelId);
    const options = currentModel?.reasoning;
    if (options && options.length > 0) {
      return [{ id: 'default', label: 'По умолчанию' }, ...options.filter(r => r.id !== 'default')];
    }
    if (modelId !== 'default' && this.selectedService() === 'codex') {
      return [
        { id: 'default', label: 'По умолчанию' },
        { id: 'low', label: 'Низкое (Low)' },
        { id: 'medium', label: 'Среднее (Medium)' },
        { id: 'high', label: 'Высокое (High)' },
        { id: 'xhigh', label: 'Очень высокое (XHigh)' }
      ];
    }
    if (modelId === 'default') {
      if (this.mode() === 'chat') {
        return [];
      }
      return [
        { id: 'default', label: 'По умолчанию' },
        { id: 'high', label: 'Высокое (High)' },
        { id: 'medium', label: 'Среднее (Medium)' },
        { id: 'low', label: 'Низкое (Low)' },
        ...(this.selectedService() === 'codex' ? [{ id: 'xhigh', label: 'Очень высокое (XHigh)' }] : [])
      ];
    }
    return [];
  });

  onReasoningChange(val: string) {
    this.selectedReasoning.set(val);
    this.validateReasoning();
  }
  private preventWindowDrop = (e: DragEvent) => {
    if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
    }
  };
  ngOnInit(){
    this.clock=setInterval(()=>this.now.set(Date.now()),1000);
    if(typeof window !== 'undefined'){
      const hasSpeech = Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
      this.speechSupported.set(hasSpeech);
      if(typeof navigator !== 'undefined' && navigator.language){
        this.voiceLang.set(navigator.language.toLowerCase().startsWith('en') ? 'en-US' : 'ru-RU');
      }
      window.addEventListener('dragover', this.preventWindowDrop);
      window.addEventListener('drop', this.preventWindowDrop);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this.onViewportResize);
      }
    }
    this.restore();
  }
  ngOnDestroy(){
    this.stopVoiceInput();
    this.socket?.disconnect();
    if(this.clock)clearInterval(this.clock);
    if(this.scrollRaf)cancelAnimationFrame(this.scrollRaf);
    this.cleanupResizeObserver();
    if(this.smoothScrollTimeout)clearTimeout(this.smoothScrollTimeout);
    if(typeof window !== 'undefined'){
      window.removeEventListener('dragover', this.preventWindowDrop);
      window.removeEventListener('drop', this.preventWindowDrop);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.onViewportResize);
      }
    }
  }
  async api<T>(path:string,options:RequestInit={}):Promise<T>{
    const r=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})},credentials:'same-origin'});
    const text=await r.text();
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      const error = new Error(
        !r.ok
          ? (r.status === 404 ? 'Запрашиваемый ресурс не найден' : `Ошибка сервера (${r.status})`)
          : 'Неверный ответ сервера (ожидался JSON)'
      ) as Error & { status: number };
      error.status = r.status;
      throw error;
    }
    if(!r.ok){
      const error=new Error(body?.error||`Ошибка запроса (${r.status})`) as Error&{status:number};
      error.status=r.status;
      throw error;
    }
    return body as T;
  }
  toggleSidebar() {
    this.sidebarOpen.update(v => !v);
  }
  formatChatsCount(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return `${n} чатов`;
    if (mod10 === 1) return `${n} чат`;
    if (mod10 >= 2 && mod10 <= 4) return `${n} чата`;
    return `${n} чатов`;
  }
  async refreshUsers(){if(!this.isOwner()||this.isDemo)return;try{this.users.set(await this.api<{id:string;username:string;createdAt:string}[]>('/users'));this.userAdminError='';}catch(e){this.userAdminError=(e as Error).message;}}
  async createUser(){this.userAdminError='';this.userAdminNotice='';try{await this.api('/users',{method:'POST',body:JSON.stringify({username:this.newUsername,password:this.newUserPassword})});this.newUsername='';this.newUserPassword='';this.userAdminNotice='Пользователь создан';await this.refreshUsers();}catch(e){this.userAdminError=(e as Error).message;}}
  async resetUserPassword(id:string){const password=window.prompt('Новый пароль (минимум 12 символов)');if(password===null)return;try{await this.api(`/users/${encodeURIComponent(id)}/password`,{method:'PUT',body:JSON.stringify({password})});this.userAdminNotice='Пароль обновлён';this.userAdminError='';}catch(e){this.userAdminError=(e as Error).message;}}
  async removeUser(id:string,username:string){if(!window.confirm(`Удалить пользователя ${username}?`))return;try{await this.api(`/users/${encodeURIComponent(id)}`,{method:'DELETE'});this.userAdminNotice='Пользователь удалён';await this.refreshUsers();}catch(e){this.userAdminError=(e as Error).message;}}

  setMode(m: 'chat' | 'work') {
    this.mobileMenu.set(false);
    this.mode.set(m);
    if (m === 'chat') {
      this.selectedService.set('chatgpt');
      this.selectedAccount = 'chatgpt';
      this.selectedProjectId.set('');
      if (this.current()?.projectId) {
        const chatSession = this.sessions().find(s => !s.projectId);
        if (chatSession) {
          void this.openSession(chatSession.id);
        } else {
          this.newSession();
        }
      } else {
        this.showPage('chat');
      }
      const available = this.models();
      if (!available.some(item => item.id === this.selectedModel())) {
        this.selectedModel.set('default');
      }
      this.validateReasoning();
    } else {
      if (this.selectedService() === 'chatgpt') {
        this.selectedService.set('auto');
        this.selectedAccount = 'auto';
      }
      if (this.page() === 'chat' && !this.current()?.projectId) {
        this.showPage('projects');
      }
      const available = this.models();
      if (!available.some(item => item.id === this.selectedModel())) {
        this.selectedModel.set('default');
      }
      this.validateReasoning();
    }
  }

  buildLocalHandoffSummary(target: 'codex' | 'chatgpt', session: ChatSession | null, note?: string): string {
    const isCodex = target === 'codex';
    const header = isCodex ? '### 📋 Передача задачи в Codex (Handoff)' : '### 💬 Обсуждение результатов с ChatGPT';
    const userMsgs = (session?.messages || []).filter(m => m.role === 'user').map(m => m.text);
    const assistantMsgs = (session?.messages || []).filter(m => m.role === 'assistant').map(m => m.text);
    const initialGoal = userMsgs[0] ? (userMsgs[0].length > 250 ? userMsgs[0].slice(0, 250) + '…' : userMsgs[0]) : (session?.title !== 'Новый чат' ? (session?.title || 'Текущая задача') : 'Текущая задача');
    const latestUser = userMsgs.length > 1 ? userMsgs[userMsgs.length - 1] : null;
    const latestAssistant = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1] : null;

    const points: string[] = [`- **Основная цель:** ${initialGoal}`];
    if (latestUser && latestUser !== initialGoal) {
      points.push(`- **Последний запрос:** ${latestUser.length > 200 ? latestUser.slice(0, 200) + '…' : latestUser}`);
    }
    if (latestAssistant) {
      const brief = latestAssistant.split('\n').filter(Boolean)[0] || latestAssistant;
      points.push(`- **Текущий статус:** ${brief.length > 250 ? brief.slice(0, 250) + '…' : brief}`);
    }
    const instruction = isCodex
      ? (note || 'Продолжи выполнение задачи, опираясь на контекст и состояние файлов проекта. Проверь код, внеси нужные правки и протестируй результат.')
      : (note || 'Ознакомься с ключевыми пунктами задачи выше. Проанализируй текущее решение, дай оценку и помоги спланировать дальнейшие шаги.');

    return `${header}\n\n` +
      `**Ключевые пункты задачи:**\n${points.join('\n')}\n\n` +
      `**Файлы и состояние Git:**\n- *Контекст передан из сессии «${session?.title || 'диалог'}»*\n\n` +
      (isCodex ? `**Инструкция для Codex:**\n${instruction}` : `**Вопрос для ChatGPT:**\n${instruction}`);
  }

  async handoff(target?: 'codex' | 'chatgpt', userNote = '') {
    if (this.handoffLoading()) return;
    const currentMode = this.mode();
    const nextTarget: 'codex' | 'chatgpt' = target || (currentMode === 'chat' ? 'codex' : 'chatgpt');
    this.handoffLoading.set(true);

    const currentSession = this.current();
    let summaryText = '';
    try {
      if (this.isDemo) {
        summaryText = this.buildLocalHandoffSummary(nextTarget, currentSession, userNote);
      } else {
        const body: any = {
          target: nextTarget,
          projectId: this.selectedProjectId() || currentSession?.projectId || undefined,
          note: userNote || undefined
        };
        const url = currentSession?.id
          ? `/sessions/${encodeURIComponent(currentSession.id)}/handoff-summary`
          : '/handoff-summary';
        const res = await this.api<{ ok: boolean; summary: string; projectId?: string }>(url, {
          method: 'POST',
          body: JSON.stringify(body)
        });
        summaryText = res?.summary || '';
        if (res?.projectId && !this.selectedProjectId()) {
          this.selectedProjectId.set(res.projectId);
        }
      }
    } catch {
      summaryText = this.buildLocalHandoffSummary(nextTarget, currentSession, userNote);
    } finally {
      this.handoffLoading.set(false);
    }

    if (!summaryText.trim()) {
      summaryText = this.buildLocalHandoffSummary(nextTarget, currentSession, userNote);
    }

    if (nextTarget === 'codex') {
      this.setMode('work');
      this.selectService('codex');
      if (!this.selectedProjectId() && this.projects().length > 0) {
        this.selectedProjectId.set(this.projects()[0].id);
      }
      this.newSession();
      this.draft = summaryText;
      setTimeout(() => {
        this.adjustTextareaHeight();
        this.adjustHeroTextareaHeight();
        this.composerTextareaRef?.nativeElement?.focus();
        this.heroComposerTextareaRef?.nativeElement?.focus();
      }, 80);
      this.notice.set('Выжимка задачи и git diff подготовлены для Codex. Нажмите Отправить или дополните запрос.');
      setTimeout(() => this.notice.set(''), 6000);
    } else {
      this.setMode('chat');
      this.selectService('chatgpt');
      this.newSession();
      this.draft = summaryText;
      setTimeout(() => {
        this.adjustTextareaHeight();
        this.adjustHeroTextareaHeight();
        this.composerTextareaRef?.nativeElement?.focus();
        this.heroComposerTextareaRef?.nativeElement?.focus();
      }, 80);
      this.notice.set('Выжимка задачи и git diff подготовлены для ChatGPT. Нажмите Отправить или дополните запрос.');
      setTimeout(() => this.notice.set(''), 6000);
    }
  }

  applySlashCommand(target: 'codex' | 'chatgpt') {
    this.draft = '';
    void this.handoff(target);
  }

  toggleProjectExpand(nameOrId: string) {
    this.expandedProjects.update(set => {
      const next = new Set(set);
      if (next.has(nameOrId)) next.delete(nameOrId);
      else next.add(nameOrId);
      return next;
    });
  }

  toggleVoiceMode() {
    if (this.speechSupported()) {
      this.toggleVoiceInput();
    } else {
      this.notice.set('Голосовой режим ChatGPT активен');
      setTimeout(() => this.notice.set(''), 3000);
    }
  }

  enableDemoMode() {
    this.isDemo = true;
    this.username = 'MO';
    this.loggedIn.set(true);
    const demoProjects: Project[] = [
      { id: 'proj-ai-router', name: 'AI Router', runnerId: 'r1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'proj-ccc', name: 'CCC-Solutions', runnerId: 'r1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'proj-wmc', name: 'WMC', runnerId: 'r1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'proj-ascs', name: 'ascs', runnerId: 'r1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'proj-gamecenter', name: 'GameCenter', runnerId: 'r1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'proj-school', name: 'School', runnerId: 'r1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'proj-quest', name: 'Quest Control', runnerId: 'r1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'proj-work', name: 'Work', runnerId: 'r1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'proj-idk', name: 'IDK', runnerId: 'r1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'proj-htlink', name: 'HTLink', runnerId: 'r1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'proj-origami', name: 'Origami', runnerId: 'r1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ];
    this.projects.set(demoProjects);

    const now = Date.now();
    const demoSessions: ChatSession[] = [
      {
        id: 'sess-krampus',
        title: 'Промо для Krampus Haus',
        updatedAt: new Date(now - 10 * 60000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Сделай промо-текст для Krampus Haus', at: new Date(now - 11 * 60000).toISOString() },
          { id: 'm2', role: 'assistant', text: 'Готовлю промо-материалы для мероприятия Krampus Haus...\n\n### 🔥 Krampus Haus: Зимний фестиваль\n* Погружение в атмосферу альпийского фольклора\n* Интерактивные зоны и шоу программа\n* Тематическая музыка и угощения', at: new Date(now - 10 * 60000).toISOString() }
        ]
      },
      {
        id: 'sess-backup-1',
        title: 'Daily Documents backup',
        updatedAt: new Date(now - 3600000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Проверь статус ежедневного бэкапа документов', at: new Date(now - 3660000).toISOString() },
          { id: 'm2', role: 'assistant', text: 'Все документы успешно синхронизированы в хранилище. Ошибок не обнаружено.', at: new Date(now - 3600000).toISOString() }
        ]
      },
      {
        id: 'sess-backup-2',
        title: 'Daily Documents backup',
        updatedAt: new Date(now - 7200000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Сделай внеплановый снапшот документов', at: new Date(now - 7260000).toISOString() },
          { id: 'm2', role: 'assistant', text: 'Внеплановый снапшот успешно создан в /backup/documents-snap.tar.gz.', at: new Date(now - 7200000).toISOString() }
        ]
      },
      {
        id: 'sess-mower-1',
        title: 'Solve Classic Lawn Mower',
        projectId: 'proj-ccc',
        updatedAt: new Date(now - 18000000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Реши задачу Classic Lawn Mower для тура Cloudflight Coding Contest', at: new Date(now - 18060000).toISOString() },
          { id: 'm2', role: 'assistant', text: 'Для задачи Classic Lawn Mower оптимальный алгоритм использует имитацию движения газонокосилки по сетке с отслеживанием скошенных клеток:\n\n```python\ndef solve_lawn_mower(grid, moves):\n    x, y = 0, 0\n    mowed = {(0, 0)}\n    directions = {"U": (0, -1), "D": (0, 1), "L": (-1, 0), "R": (1, 0)}\n    for move in moves:\n        dx, dy = directions[move]\n        x += dx\n        y += dy\n        mowed.add((x, y))\n    return len(mowed)\n```\nСложность: O(N) по времени и O(N) по памяти.', at: new Date(now - 18000000).toISOString() }
        ]
      },
      {
        id: 'sess-mower-2',
        title: 'Solve Classic Lawn Mower',
        projectId: 'proj-ccc',
        updatedAt: new Date(now - 86400000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Оптимизируй алгоритм для больших сеток 10000x10000', at: new Date(now - 86460000).toISOString() },
          { id: 'm2', role: 'assistant', text: 'Для больших сеток заменяем хэш-таблицу кортежей на одномерную битовую маску или разреженную матрицу сжатия координат.', at: new Date(now - 86400000).toISOString() }
        ]
      },
      {
        id: 'sess-clarify',
        title: 'Clarify the issue',
        projectId: 'proj-ccc',
        updatedAt: new Date(now - 172800000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Clarify the issue with timeout on runner sync', at: new Date(now - 172860000).toISOString() },
          { id: 'm2', role: 'assistant', text: 'The sync issue was caused by pingTimeout exceeding websocket threshold. Adjusted heartbeat to 15s.', at: new Date(now - 172800000).toISOString() }
        ]
      },
      {
        id: 'sess-hu-pdf',
        title: 'Improve HÜ180926 PDF',
        projectId: 'proj-ccc',
        updatedAt: new Date(now - 259200000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Improve HÜ180926 PDF layout and typography', at: new Date(now - 259260000).toISOString() },
          { id: 'm2', role: 'assistant', text: 'Updated margins to 24mm, increased line-height to 1.45, and applied modern sans-serif headings.', at: new Date(now - 259200000).toISOString() }
        ]
      },
      {
        id: 'sess-mcp-upload',
        title: 'Ускорить MCP upload и Tele...',
        projectId: 'proj-ccc',
        updatedAt: new Date(now - 345600000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Ускорить MCP upload и Telegram bridge', at: new Date(now - 345660000).toISOString() },
          { id: 'm2', role: 'assistant', text: 'Включили сжатие gzip для полезной нагрузки и пул потоков для параллельной отправки чанков.', at: new Date(now - 345600000).toISOString() }
        ]
      },
      {
        id: 'sess-quest-check',
        title: 'Проверить локальные события',
        projectId: 'proj-quest',
        updatedAt: new Date(now - 432000000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Проверить локальные события в Quest Control', at: new Date(now - 432060000).toISOString() },
          { id: 'm2', role: 'assistant', text: 'Все события верифицированы. Триггеры переходов между локациями отрабатывают корректно.', at: new Date(now - 432000000).toISOString() }
        ]
      },
      {
        id: 'sess-router-mvp',
        title: 'Создать MVP AI router',
        projectId: 'proj-ai-router',
        updatedAt: new Date(now - 518400000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Создай структуру проекта и маршрутизатор моделей', at: new Date(now - 518460000).toISOString() },
          { id: 'm2', role: 'assistant', text: 'Архитектура AI Router разделена на:\n- `backend`: Express / WebSocket хаб\n- `runner`: изолированный процесс на клиенте с прямым доступом к Codex и Antigravity\n- `frontend`: Angular веб-интерфейс', at: new Date(now - 518400000).toISOString() }
        ]
      }
    ];
    this.sessions.set(sortSessions(demoSessions));
    this.accounts.set([
      { id: 'acc-gemini', name: 'Gemini Pro Account', provider: 'antigravity', runnerId: 'r1', models: DEFAULT_GEMINI_MODELS, mode: 'runner', auth: 'ok', detail: 'Исполнитель подключён', limit: { source: 'provider', primary: { usedPercent: 12, remainingPercent: 88, windowMinutes: 300, resetAt: null }, secondary: null, cooldownUntil: null, updatedAt: null } },
      { id: 'acc-codex', name: 'Codex Account', provider: 'codex', runnerId: 'r1', models: DEFAULT_CODEX_MODELS, mode: 'runner', auth: 'ok', detail: 'Исполнитель подключён', limit: { source: 'provider', primary: { usedPercent: 35, remainingPercent: 65, windowMinutes: 300, resetAt: null }, secondary: null, cooldownUntil: null, updatedAt: null } }
    ]);
    this.runners.set([
      { id: 'r1', name: 'Мой компьютер', online: true, managementOnline: true, createdAt: new Date().toISOString() }
    ]);
    this.current.set(null);
  }

  async restore(){
    let me:{username:string;isOwner:boolean};
    try{me=await this.api<{username:string;isOwner:boolean}>('/me');}
    catch(e){
      return;
    }
    this.username=me.username;this.isOwner.set(!!me.isOwner);this.loggedIn.set(true);this.connect();
    try{await this.load();}catch(e){this.error.set((e as Error).message);}
  }
  async login(){this.loginError='';try{const me=await this.api<{username:string;isOwner:boolean}>(this.registerMode()?'/register':'/login',{method:'POST',body:JSON.stringify({username:this.loginName,password:this.password})});this.isDemo=false;this.username=me.username;this.isOwner.set(!!me.isOwner);this.password='';this.loggedIn.set(true);await this.load();this.connect();}catch(e){this.loginError=(e as Error).message;}}
  async logout(){this.stopVoiceInput();if(!this.isDemo)await this.api('/logout',{method:'POST'}).catch(()=>{});this.isDemo=false;this.socket?.disconnect();this.managedRunner.set(null);this.modelBlacklist.set([]);this.isOwner.set(false);this.users.set([]);this.loggedIn.set(false);this.current.set(null);}
  async load(){
    const [accounts,runners,projects,sessions,blacklistRes]=await Promise.all([
      this.api<Account[]>('/accounts'),
      this.api<Runner[]>('/runners'),
      this.api<Project[]>('/projects'),
      this.api<ChatSession[]>('/sessions'),
      this.api<{blacklist:string[]}>('/user/model-blacklist').catch(()=>({blacklist:[]}))
    ]);
    this.accounts.set(accounts);
    this.runners.set(runners);
    this.projects.set(projects);
    if(blacklistRes?.blacklist){
      this.modelBlacklist.set(blacklistRes.blacklist);
    }
    this.mode.set('chat');
    this.selectedService.set('chatgpt');
    this.selectedAccount='chatgpt';
    const available=this.models();
    if(!available.some(m=>m.id===this.selectedModel()))this.selectedModel.set('default');
    this.validateReasoning();
    this.selectedRunner=runners.find(r=>!r.revokedAt)?.id||'';
    const cleanSessions=sortSessions(sessions);
    this.sessions.set(cleanSessions);
    void this.refreshPreviews();
    const chatSessions = cleanSessions.filter(s => !s.projectId);
    if(chatSessions.length) await this.openSession(chatSessions[0].id);
    else if(cleanSessions.length) await this.openSession(cleanSessions[0].id);
    else this.newSession();
  }
  async refreshAccounts(){this.accounts.set(await this.api<Account[]>('/accounts'));}
  async refreshRunners(){const rows=await this.api<Runner[]>('/runners');this.runners.set(rows);const managed=this.managedRunner();if(managed)this.managedRunner.set(rows.find(row=>row.id===managed.id)||null);await this.refreshAccounts();if(!this.selectedRunner)this.selectedRunner=this.runners().find(r=>!r.revokedAt)?.id||'';}
  newSession(){
    this.stopVoiceInput();
    this.mobileMenu.set(false);
    this.current.set(null);
    this.taskFiles.set([]);
    this.sharedFileLinks.set({});
    this.collapsedDirs.set(new Set());
    this.filesFilter.set('');
    this.filesOpen.set(false);
    if (this.mode() === 'chat') {
      this.selectedProjectId.set('');
      this.selectedService.set('chatgpt');
      this.selectedAccount = 'chatgpt';
    }
    this.page.set('chat');
    this.resetRun();
    this.error.set('');
    this.ensureChatScrollAttached(true);
  }
  async openSession(id:string){
    this.stopVoiceInput();
    this.mobileMenu.set(false);
    if(this.isDemo){
      const s = this.sessions().find(x => x.id === id);
      if(s){
        this.current.set(s);
        this.taskFiles.set([]);
        this.sharedFileLinks.set({});
        this.collapsedDirs.set(new Set());
        this.filesFilter.set('');
        this.filesOpen.set(false);
        this.selectedProjectId.set(s.projectId||'');
        if (s.projectId) {
          this.mode.set('work');
          if (this.selectedService() === 'chatgpt') {
            this.selectedService.set('auto');
            this.selectedAccount = 'auto';
          }
        } else {
          this.mode.set('chat');
          this.selectedService.set('chatgpt');
          this.selectedAccount = 'chatgpt';
        }
        this.resetRun();
        this.error.set('');
        this.page.set('chat');
        this.ensureChatScrollAttached(true);
        return;
      }
    }
    try{
      const s=await this.api<ChatSession>('/sessions/'+id);
      this.current.set(s);
      this.taskFiles.set([]);
      this.sharedFileLinks.set({});
      this.collapsedDirs.set(new Set());
      this.filesFilter.set('');
      this.filesOpen.set(false);
      this.selectedProjectId.set(s.projectId||'');
      if (s.projectId) {
        this.mode.set('work');
        if (this.selectedService() === 'chatgpt') {
          this.selectedService.set('auto');
          this.selectedAccount = 'auto';
        }
      } else {
        this.mode.set('chat');
        this.selectedService.set('chatgpt');
        this.selectedAccount = 'chatgpt';
      }
      this.resetRun();
      this.error.set('');
      this.page.set('chat');
      this.syncRun(id);
      this.ensureChatScrollAttached(true);
    }catch(e){this.error.set((e as Error).message);}
  }
  async refreshTaskFiles(){const id=this.current()?.id;if(!id)return;this.filesLoading.set(true);try{const result=await this.api<{files:{name:string;size:number;modified:string}[]}>(`/sessions/${id}/files`);if(this.current()?.id===id)this.taskFiles.set(result.files);}catch(e){if(this.filesOpen())this.error.set((e as Error).message);}finally{this.filesLoading.set(false);}}
  toggleTaskFiles(){this.filesOpen.update(open=>!open);if(this.filesOpen())void this.refreshTaskFiles();}
  async shareTaskFile(name:string,download=false){const id=this.current()?.id;if(!id)return;try{const result=await this.api<{url:string;expiresAt:string}>(`/sessions/${id}/files/share`,{method:'POST',body:JSON.stringify({name})});const url=new URL(result.url,window.location.origin).href;if(this.current()?.id!==id)return;this.sharedFileLinks.update(links=>({...links,[name]:url}));if(download){window.location.assign(url);return;}try{await this.copy(url,'share-'+name);this.notice.set('Ссылка скопирована. Действует 7 дней.');}catch{this.notice.set('Ссылка готова. Скопируйте её из списка файлов.');}}catch(e){this.error.set((e as Error).message);}}
  formatFileSize(bytes?: number): string {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '0 Б';
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / (1024 * 1024)).toFixed(2) + ' МБ';
  }
  pluralizeFiles(count: number): string {
    const n = Math.abs(count) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return 'файлов';
    if (n1 > 1 && n1 < 5) return 'файла';
    if (n1 === 1) return 'файл';
    return 'файлов';
  }
  hasDirectories = computed(() => this.taskFiles().some(f => f.name.includes('/')));
  totalFilesSize = computed(() => {
    const total = this.taskFiles().reduce((acc, f) => acc + (f.size || 0), 0);
    return this.formatFileSize(total);
  });
  allDirPaths = computed(() => {
    const dirs = new Set<string>();
    for (const file of this.taskFiles()) {
      const parts = file.name.split('/').filter(Boolean);
      let cur = '';
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i];
        dirs.add(cur);
      }
    }
    return Array.from(dirs);
  });
  visibleFileTree = computed<FlatFileNode[]>(() => {
    const files = this.taskFiles();
    const filter = this.filesFilter().trim().toLowerCase();
    const collapsed = this.collapsedDirs();
    const root: FileNodeInternal = {
      name: '',
      path: '',
      isDir: true,
      size: 0,
      fileCount: 0,
      children: new Map()
    };
    for (const file of files) {
      if (filter && !file.name.toLowerCase().includes(filter)) {
        continue;
      }
      const parts = file.name.split('/').filter(Boolean);
      if (!parts.length) continue;
      let current = root;
      let currentPath = '';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (isFile) {
          current.children.set(part, {
            name: part,
            path: file.name,
            isDir: false,
            size: file.size,
            modified: file.modified,
            fileCount: 1,
            children: new Map()
          });
        } else {
          let dirNode = current.children.get(part);
          if (!dirNode) {
            dirNode = {
              name: part,
              path: currentPath,
              isDir: true,
              size: 0,
              fileCount: 0,
              children: new Map()
            };
            current.children.set(part, dirNode);
          }
          current = dirNode;
        }
      }
    }
    function rollup(node: FileNodeInternal): { size: number; count: number } {
      if (!node.isDir) return { size: node.size, count: 1 };
      let totalSize = 0;
      let totalCount = 0;
      for (const child of node.children.values()) {
        const res = rollup(child);
        totalSize += res.size;
        totalCount += res.count;
      }
      node.size = totalSize;
      node.fileCount = totalCount;
      return { size: totalSize, count: totalCount };
    }
    rollup(root);
    const result: FlatFileNode[] = [];
    function flatten(node: FileNodeInternal, depth: number) {
      const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      for (const child of sortedChildren) {
        if (child.isDir) {
          const isExpanded = filter ? true : !collapsed.has(child.path);
          result.push({
            name: child.name,
            path: child.path,
            isDir: true,
            depth,
            size: child.size,
            fileCount: child.fileCount,
            isExpanded
          });
          if (isExpanded) {
            flatten(child, depth + 1);
          }
        } else {
          result.push({
            name: child.name,
            path: child.path,
            isDir: false,
            depth,
            size: child.size,
            modified: child.modified
          });
        }
      }
    }
    flatten(root, 0);
    return result;
  });
  toggleFolder(path: string) {
    this.collapsedDirs.update(set => {
      const next = new Set(set);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }
  collapseAllFolders() {
    this.collapsedDirs.set(new Set(this.allDirPaths()));
  }
  expandAllFolders() {
    this.collapsedDirs.set(new Set());
  }
  chatsFor(projectId?:string){return sortSessions(this.sessions().filter(s=>projectId?s.projectId===projectId:!s.projectId));}
  projectIcon(p: Project | string): 'folder' | 'graduation-cap' | 'origami' {
    const name = typeof p === 'string' ? p : p.name;
    if (name === 'HTLink') return 'graduation-cap';
    if (name === 'Origami') return 'origami';
    return 'folder';
  }

  isProjectExpanded(p: Project | string): boolean {
    const key = typeof p === 'string' ? p : (p.id || p.name);
    const name = typeof p === 'string' ? p : p.name;
    return this.expandedProjects().has(key) || this.expandedProjects().has(name);
  }

  chatsForProject(p: Project): ChatSession[] {
    return this.chatsFor(p.id);
  }

  filteredRecentSessions = computed(() => {
    const query = this.sidebarSearch().trim().toLowerCase();
    const isChat = this.mode() === 'chat';
    const all = sortSessions(this.sessions()).filter(s => isChat ? !s.projectId : Boolean(s.projectId));
    if (!query) return all;
    return all.filter(s => s.title.toLowerCase().includes(query));
  });

  filteredProjects = computed(() => {
    const query = this.sidebarSearch().trim().toLowerCase();
    const all = this.projects();
    if (!query) return all;
    return all.filter(p => p.name.toLowerCase().includes(query));
  });
  projectRunner(project:Project){return this.runners().find(r=>r.id===project.runnerId)?.name||'Исполнитель';}
  selectProject(id:string){this.selectedProjectId.set(id);this.setMode('work');this.page.set('projects');this.mobileMenu.set(false);}
  newSessionFor(projectId:string){this.setMode('work');this.selectedProjectId.set(projectId);this.newSession();}
  async createProject(){const name=window.prompt('Название проекта');if(!name?.trim())return;const runnerId=this.selectedRunner||this.runners().find(r=>!r.revokedAt)?.id;if(!runnerId){this.error.set('Сначала подключите исполнитель');return;}try{const project=await this.api<Project>('/projects',{method:'POST',body:JSON.stringify({name:name.trim(),runnerId})});this.projects.update(v=>[project,...v]);this.selectedProjectId.set(project.id);this.notice.set(`Проект «${project.name}» создан`);this.newSession();}catch(e){this.error.set((e as Error).message);}}
  onDragEnter(event: DragEvent) {
    if (this.page() !== 'chat' || !this.loggedIn()) return;
    if (!event.dataTransfer?.types || !Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    this.dragCounter++;
    if (this.dragCounter === 1) {
      this.isDraggingOver.set(true);
    }
  }

  onDragOver(event: DragEvent) {
    if (this.page() !== 'chat' || !this.loggedIn()) return;
    if (!event.dataTransfer?.types || !Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  onDragLeave(event: DragEvent) {
    if (this.page() !== 'chat' || !this.loggedIn()) return;
    this.dragCounter--;
    if (this.dragCounter <= 0) {
      this.dragCounter = 0;
      this.isDraggingOver.set(false);
    }
  }

  onDrop(event: DragEvent) {
    if (this.page() !== 'chat' || !this.loggedIn()) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter = 0;
    this.isDraggingOver.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      void this.uploadFiles(files);
    }
  }

  onPaste(event: ClipboardEvent) {
    if (this.page() !== 'chat' || !this.loggedIn()) return;
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const files: File[] = [];
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const f = clipboardData.files[i];
        if (f) files.push(f);
      }
    } else if (clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }

    if (files.length > 0) {
      event.preventDefault();
      void this.uploadFiles(files);
    }
  }

  async ensureCurrentProjectId(): Promise<string> {
    const currentSession = this.current();
    if (!currentSession) throw new Error('Сначала откройте или создайте чат');
    if (currentSession.projectId) return currentSession.projectId;

    let projectId = this.selectedProjectId();
    if (!projectId && this.projects().length > 0) {
      projectId = this.projects()[0].id;
    }

    if (!projectId) {
      const activeRunner = this.runners().find(r => !r.revokedAt);
      if (!activeRunner) {
        throw new Error('Для загрузки файлов подключите исполнитель (runner)');
      }
      const newProj = await this.api<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Основной проект', runnerId: activeRunner.id })
      });
      this.projects.update(list => [newProj, ...list]);
      projectId = newProj.id;
    }

    try {
      const updated = await this.api<ChatSession>('/sessions/' + currentSession.id, {
        method: 'PATCH',
        body: JSON.stringify({ projectId })
      });
      this.current.set(updated);
      this.sessions.update(list => list.map(s => s.id === updated.id ? updated : s));
    } catch {
      this.current.update(c => c ? { ...c, projectId } : c);
    }
    this.selectedProjectId.set(projectId);
    return projectId;
  }

  async uploadFiles(fileList: File[] | FileList) {
    const rawFiles = Array.from(fileList).filter(f => f && f.size > 0);
    if (!rawFiles.length) return;

    this.error.set('');
    this.uploading.set(true);

    try {
      const projectId = await this.ensureCurrentProjectId();
      const uploadedNames: string[] = [];
      const errors: string[] = [];

      for (let i = 0; i < rawFiles.length; i++) {
        const file = rawFiles[i];
        if (file.size > 20 * 1024 * 1024) {
          errors.push(`«${file.name}» больше 20 МБ`);
          continue;
        }

        let name = file.name;
        if (!name || name === 'image.png' || name === 'blob') {
          const ext = file.type ? (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg') : 'png';
          const now = new Date();
          const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
          name = `screenshot-${timeStr}.${ext}`;
        }

        let finalName = name;
        let counter = 1;
        while (uploadedNames.includes(finalName)) {
          const dotIdx = name.lastIndexOf('.');
          if (dotIdx > 0) {
            finalName = `${name.slice(0, dotIdx)}-${counter}${name.slice(dotIdx)}`;
          } else {
            finalName = `${name}-${counter}`;
          }
          counter++;
        }

        if (rawFiles.length > 1) {
          this.notice.set(`Загрузка файлов (${i + 1}/${rawFiles.length}): «${finalName}»...`);
        } else {
          this.notice.set(`Загрузка «${finalName}»...`);
        }

        try {
          const response = await fetch(`/api/projects/${projectId}/files`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-File-Name': encodeURIComponent(finalName)
            },
            body: file,
            credentials: 'same-origin'
          });
          const body = await response.json() as { name?: string; size?: number; error?: string };
          if (!response.ok) {
            throw new Error(body.error || `Не удалось загрузить «${finalName}»`);
          }
          uploadedNames.push(body.name || finalName);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : `Ошибка загрузки «${finalName}»`);
        }
      }

      if (uploadedNames.length > 0) {
        this.mentionFiles(uploadedNames);
        if (uploadedNames.length === 1) {
          this.notice.set(`Файл «${uploadedNames[0]}» добавлен в проект и упомянут в сообщении`);
        } else {
          this.notice.set(`Загружено ${uploadedNames.length} файлов в проект и упомянуто в сообщении`);
        }
      }

      if (errors.length > 0) {
        this.error.set(errors.join(' · '));
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Не удалось загрузить файлы');
    } finally {
      this.uploading.set(false);
    }
  }

  mentionFiles(names: string[]) {
    if (!names.length) return;
    const mentions = names.map(n => n.includes(' ') ? `@"${n}"` : `@${n}`).join(' ');

    const textarea = this.composerTextareaRef?.nativeElement;
    const currentText = this.draft || '';

    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      let newText = '';
      let newCursorPos = 0;

      if (typeof start === 'number' && typeof end === 'number' && (document.activeElement === textarea || start !== end || currentText.length > 0)) {
        const before = currentText.substring(0, start);
        const after = currentText.substring(end);

        const needLeadingSpace = before.length > 0 && !/\s$/.test(before);
        const needTrailingSpace = after.length > 0 && !/^\s/.test(after);

        const inserted = (needLeadingSpace ? ' ' : '') + mentions + (needTrailingSpace ? ' ' : ' ');
        newText = before + inserted + after;
        newCursorPos = (before + inserted).length;
      } else {
        const needLeadingSpace = currentText.length > 0 && !/\s$/.test(currentText);
        newText = currentText + (needLeadingSpace ? ' ' : '') + mentions + ' ';
        newCursorPos = newText.length;
      }

      this.draft = newText;
      setTimeout(() => {
        this.adjustTextareaHeight();
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 10);
    } else {
      const needLeadingSpace = currentText.length > 0 && !/\s$/.test(currentText);
      this.draft = currentText + (needLeadingSpace ? ' ' : '') + mentions + ' ';
    }
  }

  uploadFile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const files = input.files;
    void this.uploadFiles(files);
    input.value = '';
  }
  showPage(page:'chat'|'projects'|'sites'|'providers'|'connections'|'runners'|'users'){
    if(page==='users'&&!this.isOwner())return;
    this.stopVoiceInput();
    this.page.set(page);
    this.mobileMenu.set(false);
    if(page!=='chat'){
      this.mode.set('work');
      if(this.selectedService()==='chatgpt'){
        this.selectedService.set('auto');
        this.selectedAccount='auto';
      }
    }
    if(page==='runners')this.refreshRunners();
    else this.managedRunner.set(null);
    if(page==='sites')void this.refreshPreviews();
    if(page==='providers')void this.refreshProviders();
    if(page==='users')void this.refreshUsers();
    if(page==='chat')this.ensureChatScrollAttached(true);
    else this.cleanupResizeObserver();
  }
  async refreshPreviews(){try{const rows=await Promise.all(this.runners().filter(r=>!r.revokedAt).map(r=>this.api<Preview[]>('/runners/'+r.id+'/previews')));this.previews.set(rows.flat().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}catch(e){if(this.page()==='sites')this.error.set((e as Error).message);}}
  async setPreviewVisible(preview:Preview,visible:boolean){try{await this.api('/runners/'+preview.runnerId+'/previews/'+preview.subdomain,{method:'PATCH',body:JSON.stringify({visible})});await this.refreshPreviews();this.notice.set(visible?'Сайт открыт':'Сайт скрыт');}catch(e){this.error.set((e as Error).message);}}
  previewRunner(preview:Preview){return this.runners().find(r=>r.id===preview.runnerId)?.name||'Runner';}
  connect(){this.socket?.disconnect();this.socket=io({path:'/socket.io',transports:['websocket']});this.socket.on('connect',()=>{if(this.error()==='Соединение с сервером потеряно')this.error.set('');const id=this.current()?.id;if(id)this.syncRun(id);});this.socket.on('disconnect',()=>{if(this.running())this.notice.set('Соединение потеряно. Восстанавливаем статус задачи…');});this.socket.on('ai:event',(e:AIEvent)=>this.onEvent(e));this.socket.on('accounts:changed',(a:Account[])=>{this.accounts.set(a);const available=this.models();if(!available.some(m=>m.id===this.selectedModel()))this.selectedModel.set('default');this.validateReasoning();});this.socket.on('connect_error',()=>this.error.set('Соединение с сервером потеряно'));}
  resetRun(){this.running.set(false);this.runId.set('');this.stream.set('');this.activeAccount.set('');this.activeProvider.set(undefined);this.activity.set([]);this.runStartedAt.set('');}
  syncRun(sessionId:string){if(!this.socket?.connected)return;this.socket.emit('run:state',sessionId,(state:RunState|null)=>{if(this.current()?.id!==sessionId)return;if(!state){const wasRunning=this.running();this.resetRun();this.notice.set('');if(wasRunning)this.error.set('Соединение восстановлено, но статус задачи недоступен. Обновите чат или повторите запрос.');void this.reloadCurrent();return;}if('type' in state){const wasRunning=this.running()||this.runId()===state.runId;this.resetRun();this.notice.set('');if(wasRunning){if(state.type==='error')this.error.set(state.message);else{this.error.set('');this.notice.set(state.message||'Готово');}}void this.reloadCurrent();return;}this.runId.set(state.runId);this.running.set(true);this.runStartedAt.set(state.startedAt);this.activeAccount.set(state.accountId||'');if(state.provider)this.activeProvider.set(state.provider);this.stream.set(state.stream||'');this.activity.set(state.activity||[]);this.notice.set(state.message||'Задача выполняется');this.error.set('');this.requestScrollToBottom();});}
  onEvent(e:AIEvent){if(e.sessionId!==this.current()?.id)return;if(e.provider)this.activeProvider.set(e.provider as ProviderId);if(e.type==='started'){this.running.set(true);this.runId.set(e.runId);this.runStartedAt.set(new Date().toISOString());this.activity.set([]);this.notice.set(e.message||'Запрос принят');this.requestScrollToBottom();}else if(e.type==='delta'){this.stream.update(s=>s+(e.text||''));this.activeAccount.set(e.data?.accountId||'');this.requestScrollToBottom();}else if(e.type==='status'||e.type==='tool'||e.type==='fallback'||e.type==='checkpoint'||e.type==='handoff_started'||e.type==='handoff_ready'){if(e.type==='handoff_started')this.stream.set('');if(e.message){this.notice.set(e.message);this.activity.update(rows=>[...rows,{type:e.type,message:e.message!,at:new Date().toISOString(),provider:e.provider as ProviderId,accountId:e.data?.accountId}].slice(-12));}this.activeAccount.set(e.data?.accountId||this.activeAccount());this.requestScrollToBottom();}else if(e.type==='error'){this.error.set(e.message||'Ошибка');this.resetRun();this.reloadCurrent();}else if(e.type==='completed'){this.resetRun();this.notice.set(e.message||'Готово');this.reloadCurrent();void this.refreshTaskFiles();}}
  async reloadCurrent(){
    const id=this.current()?.id;
    if(!id)return;
    const s=await this.api<ChatSession>('/sessions/'+id);
    this.current.set(s);
    this.sessions.update(list=>{
      const next=list.map(x=>x.id===s.id?s:x);
      if(!next.some(x=>x.id===s.id)&&s.messages&&s.messages.length>0){next.push(s);}
      return sortSessions(next);
    });
    this.requestScrollToBottom();
  }
  async send(){
    if(this.isRecording())this.stopVoiceInput();
    const prompt=this.draft.trim();
    if(!prompt||this.running())return;

    if(prompt.startsWith('/codex')){
      const note=prompt.replace(/^\/codex\s*/,'');
      this.draft='';
      void this.handoff('codex',note);
      return;
    }
    if(prompt.startsWith('/chatgpt')){
      const note=prompt.replace(/^\/chatgpt\s*/,'');
      this.draft='';
      void this.handoff('chatgpt',note);
      return;
    }

    let s=this.current();
    if(!s||!s.id){
      if(this.isDemo){
        s = {
          id: 'sess-' + Date.now(),
          title: prompt.length > 28 ? prompt.slice(0, 28) + '...' : prompt,
          updatedAt: new Date().toISOString(),
          messages: []
        };
        this.current.set(s);
      } else {
        try {
          const projectId=this.mode() === 'chat' ? undefined : (this.selectedProjectId()||undefined);
          s=await this.api<ChatSession>('/sessions',{method:'POST',body:JSON.stringify(projectId?{projectId}:{})});
          this.current.set(s);
        } catch(e) {
          this.error.set((e as Error).message);
          return;
        }
      }
    }

    if(!s){
      this.error.set('Не удалось создать чат');
      return;
    }
    if(this.isDemo){
      this.sendDemoMessage(prompt, s);
      return;
    }
    if(!this.socket?.connected){
      this.error.set('Соединение с сервером потеряно');
      return;
    }
    this.error.set('');this.notice.set('');this.stream.set('');this.activity.set([]);
    const now=new Date().toISOString();
    this.runStartedAt.set(now);this.running.set(true);this.draft='';setTimeout(()=>this.adjustTextareaHeight(),0);this.userScrolledUp.set(false);this.showScrollBottom.set(false);this.isSmoothScrollingToBottom=false;
    const userMsg:Message={id:'pending',role:'user',text:prompt,at:now};
    const updatedSession:ChatSession={
      ...s,
      title:s.title==='Новый чат'?(prompt.length>28?prompt.slice(0,28)+'...':prompt):s.title,
      messages:[...(s.messages||[]),userMsg],
      updatedAt:now
    };
    this.current.set(updatedSession);
    this.sessions.update(list=>sortSessions([updatedSession,...list.filter(x=>x.id!==updatedSession.id)]));
    this.scrollToBottom(true,'auto');
    requestAnimationFrame(()=>this.scrollToBottom(true,'auto'));
    const targetService = this.mode() === 'chat' ? 'chatgpt' : this.selectedService();
    const targetMode = this.mode() === 'chat' ? 'chat' : 'task';
    this.socket?.emit('run',{sessionId:s.id,prompt,service:targetService,accountId:targetService,model:this.selectedModel(),reasoning:this.selectedReasoning(),fast:targetService==='codex'&&this.codexFast(),mode:targetMode},(ack:{ok:boolean;runId?:string;error?:string})=>{if(ack.ok){this.runId.set(ack.runId||'');this.requestScrollToBottom(true);}else{this.resetRun();this.error.set(ack.error||'Ошибка');this.draft=prompt;this.reloadCurrent();if(ack.error==='Этот чат уже занят')this.syncRun(s!.id);}});
  }

  sendDemoMessage(prompt: string, s: ChatSession) {
    this.error.set('');
    this.notice.set('');
    this.stream.set('');
    this.activity.set([]);
    const now = new Date().toISOString();
    this.runStartedAt.set(now);
    this.running.set(true);
    this.draft = '';
    setTimeout(() => this.adjustTextareaHeight(), 0);
    this.userScrolledUp.set(false);
    this.showScrollBottom.set(false);
    this.isSmoothScrollingToBottom = false;

    const userMsg: Message = {
      id: 'u-' + Date.now(),
      role: 'user',
      text: prompt,
      at: now
    };
    const updated: ChatSession = {
      ...s,
      title: s.title === 'Новый чат' ? (prompt.length > 28 ? prompt.slice(0, 28) + '...' : prompt) : s.title,
      messages: [...s.messages, userMsg],
      updatedAt: now
    };
    this.current.set(updated);
    this.sessions.update(list => sortSessions([updated, ...list.filter(x => x.id !== updated.id)]));
    this.scrollToBottom(true, 'auto');

    const responses = [
      `Я обработал ваш запрос «${prompt}».\n\n### Резюме решения\n\n\`\`\`typescript\n// Автоматически сгенерированный модуль\nexport function executeTask(params: Record<string, unknown>) {\n  console.log("Выполнение задачи:", params);\n  return { success: true, timestamp: Date.now() };\n}\n\`\`\`\n\n- Архитектурная проверка пройдена\n- Все тесты завершены успешно`,
      `Отличный вопрос! Вот ключевые шаги по реализации:\n\n1. **Инициализация контекста**: настраиваем рабочее окружение проекта.\n2. **Обработка данных**: применяем алгоритм оптимизации.\n3. **Тестирование**: проверяем краевые случаи и производительность.\n\n\`\`\`python\ndef solve():\n    return "Готово!"\n\`\`\``,
      `Всё готово! Задача выполнена в полном соответствии с требованиями.\n\n> Если потребуются дополнительные правки или тесты — просто напишите!`
    ];
    const fullText = responses[Math.floor(Math.random() * responses.length)];
    let index = 0;
    const interval = setInterval(() => {
      index += Math.floor(Math.random() * 8) + 4;
      if (index >= fullText.length) {
        clearInterval(interval);
        this.stream.set('');
        this.running.set(false);
        const assistantNow = new Date().toISOString();
        const assistantMsg: Message = {
          id: 'a-' + Date.now(),
          role: 'assistant',
          text: fullText,
          at: assistantNow
        };
        const finalSession: ChatSession = {
          ...this.current()!,
          messages: [...(this.current()?.messages || []), assistantMsg],
          updatedAt: assistantNow
        };
        this.current.set(finalSession);
        this.sessions.update(list => sortSessions([finalSession, ...list.filter(x => x.id !== finalSession.id)]));
        this.scrollToBottom(true, 'smooth');
      } else {
        this.stream.set(fullText.slice(0, index));
        this.requestScrollToBottom();
      }
    }, 35);
  }
  cancel(){if(this.runId())this.socket?.emit('cancel',this.runId());}
  elapsed(){const start=Date.parse(this.runStartedAt());if(!Number.isFinite(start))return '0:00';const seconds=Math.max(0,Math.floor((this.now()-start)/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
  async addAccount(){
    if(this.addingAccount())return;
    this.error.set('');this.addingAccount.set(true);
    try{
      const isApi=this.accountProvider==='openai-api';
      await this.api('/accounts',{method:'POST',body:JSON.stringify({provider:isApi?'codex':this.accountProvider,name:this.accountName,runnerId:this.selectedRunner,...(isApi?{authType:'api_key'}:{})})});
      this.accountName='';await this.refreshAccounts();
      this.notice.set(isApi?'Подключение создано. Введите API-ключ в его карточке.':'Аккаунт добавлен. Выполните команду входа на своём контейнере.');
    }catch(e){this.error.set((e as Error).message);}finally{this.addingAccount.set(false);}
  }
  async saveOpenAIKey(a:Account){
    if(this.savingApiKey())return;
    const apiKey=(this.apiKeyDrafts[a.id]||'').trim();if(!apiKey)return;
    this.savingApiKey.set(a.id);this.error.set('');
    try{await this.api('/accounts/'+a.id+'/api-key',{method:'PUT',body:JSON.stringify({apiKey})});this.apiKeyDrafts[a.id]='';await this.refreshAccounts();this.notice.set('API-ключ сохранён. Модели появятся в выборе Codex после обновления статуса.');}
    catch(e){this.error.set((e as Error).message);}finally{this.savingApiKey.set('');}
  }
  async assignAccount(a:Account,runnerId:string){try{await this.api('/accounts/'+a.id,{method:'PATCH',body:JSON.stringify({runnerId})});await this.refreshAccounts();}catch(e){this.error.set((e as Error).message);}}
  async setAccountPriority(a:Account,value:string){
    const priority=Number(value);
    if(priority!==0&&priority!==1&&priority!==2)return;
    try{
      await this.api('/accounts/'+a.id+'/priority',{method:'PATCH',body:JSON.stringify({priority})});
      await this.refreshAccounts();
      this.notice.set('Приоритет аккаунта сохранён');
    }catch(e){this.error.set((e as Error).message);await this.refreshAccounts();}
  }
  async removeAccount(a:Account){
    if(this.deletingAccount()||!window.confirm(`Удалить подключение «${a.name}»? Данные входа и API-ключ на runner будут удалены.`))return;
    this.deletingAccount.set(a.id);this.error.set('');
    try{await this.api('/accounts/'+encodeURIComponent(a.id),{method:'DELETE'});delete this.apiKeyDrafts[a.id];await this.refreshAccounts();this.notice.set('Подключение удалено');}
    catch(e){this.error.set((e as Error).message);}finally{this.deletingAccount.set('');}
  }
  runnerInstructionTab = signal<'quick' | 'detailed'>('quick');
  serverOrigin(): string {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return 'https://ai.s1m4.com';
  }
  pairingCodePlaceholder(): string {
    return this.pairing()?.code || '<ВАШ_КОД_ПРИВЯЗКИ>';
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

  async createPairing(){this.error.set('');try{this.pairing.set(await this.api<Pairing>('/runners/pairing',{method:'POST',body:JSON.stringify({name:this.runnerName})}));}catch(e){this.error.set((e as Error).message);}}
  async revokeRunner(r:Runner){if(!confirm(`Отключить ${r.name}? Его задачи остановятся.`))return;try{await this.api('/runners/'+r.id,{method:'DELETE'});await this.refreshRunners();}catch(e){this.error.set((e as Error).message);}}
  loginCommand(a:Account){return `docker compose -f runner/compose.yaml exec runner /app/scripts/provider-login.sh ${a.provider} ${a.id}`;}
  async copy(text:string, id:string=''){
    await navigator.clipboard.writeText(text);
    if(id){
      this.copiedId.set(id);
      setTimeout(()=>{if(this.copiedId()===id)this.copiedId.set('');},2000);
    }
    this.notice.set('Скопировано в буфер обмена');
  }
  accountLabel(id:string){return this.accounts().find(a=>a.id===id)?.name||'';}
  providerLabel(id?:ProviderId|string){return id==='codex'?'Codex':(id==='antigravity'||id==='gemini')?'Gemini':id==='chatgpt'?'ChatGPT':'';}
  limitLabel(a:Account){if(a.limit.cooldownUntil)return 'Ограничен';if(a.limit.primary||a.limit.secondary)return 'Квота аккаунта';return 'Провайдер';}
  windowLabel(window:UsageWindow){const minutes=window.windowMinutes;if(minutes===300)return '5 ч';if(minutes===10080)return 'Неделя';if(minutes===43200)return 'Месяц';if(minutes&&minutes%60===0)return `${minutes/60} ч`;return 'Окно';}
  remaining(window:UsageWindow|null){return window?`${Math.round(window.remainingPercent)}%`:'';}
  resetLabel(window:UsageWindow){if(!window.resetAt)return '';const date=new Date(window.resetAt);return Number.isFinite(date.getTime())?`Сброс ${new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(date)}`:'';}
  accountMode(a:Account){return a.mode==='runner'?'Контейнер в сети':a.mode==='offline'?'Не в сети':'Без контейнера';}
  hasAccountsFor(service:ServiceId):boolean{const accounts=Array.isArray(this.accounts()) ? this.accounts() : [];if(service==='auto')return accounts.length>0;const provider:ProviderId=service==='gemini'?'antigravity':service==='codex'?'codex':'chatgpt';const pId=this.current()?.projectId;const project=pId?this.projects().find(p=>p.id===pId):null;const list=project?accounts.filter(a=>a.runnerId===project.runnerId):accounts;return list.some(a=>a.provider===provider);}
  selectService(service:ServiceId){this.selectedService.set(service);this.selectedAccount=service;const available=this.models();if(!available.some(m=>m.id===this.selectedModel()))this.selectedModel.set('default');this.validateReasoning();}
  selectAccount(id:string){this.selectedAccount=id;this.selectedModel.set('default');this.selectedReasoning.set('default');}
  selectModel(id:string){
    this.selectedModel.set(id);
    if(this.mode() === 'chat'){
      this.selectedService.set('chatgpt');
      this.selectedAccount='chatgpt';
    } else if(id!=='default'){
      const isGemini=this.allGeminiModels().some(m=>m.id===id);
      const isCodex=this.allCodexModels().some(m=>m.id===id);
      const isChatGPT=this.allChatGPTModels().some(m=>m.id===id);
      if(isGemini){
        this.selectedService.set('gemini');
        this.selectedAccount='gemini';
      } else if(isCodex){
        this.selectedService.set('codex');
        this.selectedAccount='codex';
      } else if(isChatGPT){
        this.selectedService.set('chatgpt');
        this.selectedAccount='chatgpt';
      }
    }
    const currentModel=this.models().find(m=>m.id===id)
                    ||this.allGeminiModels().find(m=>m.id===id)
                    ||this.allCodexModels().find(m=>m.id===id)
                    ||this.allChatGPTModels().find(m=>m.id===id);
    if(currentModel?.defaultReasoning && (!this.selectedReasoning() || this.selectedReasoning()==='default')){
      this.selectedReasoning.set(currentModel.defaultReasoning);
    }
    this.validateReasoning();
  }
  validateReasoning(){
    const modelId=this.selectedModel();
    const currentModel=this.models().find(m=>m.id===modelId)
                    ||this.allGeminiModels().find(m=>m.id===modelId)
                    ||this.allCodexModels().find(m=>m.id===modelId)
                    ||this.allChatGPTModels().find(m=>m.id===modelId);
    const reasoningExists=currentModel?.reasoning?.some(r=>r.id===this.selectedReasoning());
    if(modelId!=='default' && this.selectedReasoning()!=='default' && currentModel?.reasoning?.length && !reasoningExists){
      this.selectedReasoning.set(currentModel?.defaultReasoning||'default');
    }
  }
  currentRunnerLabel():string{
    const name=this.accountLabel(this.activeAccount());
    if(name)return name;
    const prov=this.activeProvider();
    if(prov)return this.providerLabel(prov);
    const modelId=this.selectedModel();
    if(modelId!=='default'){
      const m=this.models().find(x=>x.id===modelId)
           ||this.allGeminiModels().find(x=>x.id===modelId)
           ||this.allCodexModels().find(x=>x.id===modelId)
           ||this.allChatGPTModels().find(x=>x.id===modelId);
      if(m)return m.label.replace(/\s*·\s*(Gemini|Codex|ChatGPT)$/,'');
    }
    const s=this.selectedService();
    return s==='gemini'?'Gemini':s==='codex'?'Codex':'ChatGPT';
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
        body: JSON.stringify(payload)
      });
      this.notice.set('Сессия ChatGPT успешно сохранена!');
      this.closeChatGPTSessionModal();
      await this.refreshAccounts();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.chatgptImporting.set(false);
    }
  }

  handleChatClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const copyBtn = target.closest('.copy-code-btn') as HTMLButtonElement | null;
    if (!copyBtn) return;

    event.preventDefault();
    event.stopPropagation();

    const codeBlock = copyBtn.closest('.code-block');
    const codeEl = codeBlock?.querySelector('pre code');
    const codeText = codeEl?.textContent || '';
    if (!codeText) return;

    navigator.clipboard.writeText(codeText).then(() => {
      copyBtn.classList.add('copied');
      const label = copyBtn.querySelector('.copy-label');
      if (label) label.textContent = 'Скопировано!';
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        if (label) label.textContent = 'Копировать';
      }, 2000);
      this.notice.set('Код скопирован в буфер обмена');
    }).catch(() => {
      this.notice.set('Не удалось скопировать код');
    });
  }

  @ViewChild('heroComposerTextarea') heroComposerTextareaRef?: ElementRef<HTMLTextAreaElement>;

  adjustHeroTextareaHeight() {
    const el = this.heroComposerTextareaRef?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }

  onComposerEnter(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      const trimmed = this.draft.trim();
      if (trimmed.startsWith('/codex')) {
        e.preventDefault();
        const note = trimmed.replace(/^\/codex\s*/, '');
        this.draft = '';
        void this.handoff('codex', note);
        return;
      }
      if (trimmed.startsWith('/chatgpt')) {
        e.preventDefault();
        const note = trimmed.replace(/^\/chatgpt\s*/, '');
        this.draft = '';
        void this.handoff('chatgpt', note);
        return;
      }
      e.preventDefault();
      this.send();
    }
  }

  adjustTextareaHeight() {
    const el = this.composerTextareaRef?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }

  toggleVoiceLang() {
    const nextLang = this.voiceLang() === 'ru-RU' ? 'en-US' : 'ru-RU';
    this.voiceLang.set(nextLang);
    if (this.isRecording()) {
      this.stopVoiceInput();
      setTimeout(() => this.startVoiceInput(), 100);
    }
  }

  toggleVoiceInput() {
    if (this.isRecording()) {
      this.stopVoiceInput();
    } else {
      this.startVoiceInput();
    }
  }

  startVoiceInput() {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.error.set('Голосовой ввод не поддерживается вашим браузером. Рекомендуется Chrome, Edge или Safari.');
      return;
    }

    try {
      if (this.recognition) {
        try { this.recognition.abort(); } catch {}
        this.recognition = null;
      }

      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = this.voiceLang();
      rec.maxAlternatives = 1;

      this.recordingBaseText = this.draft;
      this.error.set('');

      rec.onstart = () => {
        this.isRecording.set(true);
      };

      rec.onresult = (event: any) => {
        let interim = '';
        let accumulatedFinal = '';

        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript || '';
          if (result.isFinal) {
            accumulatedFinal += text;
          } else {
            interim += text;
          }
        }

        const combinedSpeech = (accumulatedFinal + interim).trimStart();
        if (this.recordingBaseText) {
          const needsSpace = !this.recordingBaseText.endsWith(' ') && !this.recordingBaseText.endsWith('\n');
          this.draft = this.recordingBaseText + (needsSpace ? ' ' : '') + combinedSpeech;
        } else {
          this.draft = combinedSpeech;
        }
        this.adjustTextareaHeight();
      };

      rec.onerror = (event: any) => {
        console.warn('SpeechRecognition error:', event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.error.set('Доступ к микрофону запрещен. Разрешите доступ к микрофону в настройках браузера.');
          this.stopVoiceInput();
        } else if (event.error === 'no-speech') {
          // No speech detected, quietly ignore
        } else if (event.error === 'audio-capture') {
          this.error.set('Микрофон не обнаружен. Проверьте подключение аудиоустройств.');
          this.stopVoiceInput();
        } else if (event.error === 'network') {
          this.error.set('Сетевая ошибка службы распознавания речи.');
          this.stopVoiceInput();
        } else if (event.error !== 'aborted') {
          this.error.set(`Ошибка голосового ввода: ${event.error}`);
          this.stopVoiceInput();
        }
      };

      rec.onend = () => {
        this.isRecording.set(false);
        this.recordingBaseText = '';
        this.draft = this.draft.trim();
        this.adjustTextareaHeight();
      };

      this.recognition = rec;
      rec.start();
    } catch (err: any) {
      console.error('Failed to start speech recognition:', err);
      this.isRecording.set(false);
      this.error.set('Не удалось активировать микрофон: ' + (err?.message || err));
    }
  }

  stopVoiceInput() {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
      this.recognition = null;
    }
    this.isRecording.set(false);
    this.recordingBaseText = '';
    this.draft = this.draft.trim();
    this.adjustTextareaHeight();
  }
}
