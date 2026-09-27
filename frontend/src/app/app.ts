import { Component, OnInit, AfterViewInit, OnDestroy, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { io, Socket } from 'socket.io-client';
import {
  LucideArrowUp, LucideArrowUpRight, LucideAudioLines, LucideAudioWaveform, LucideBell, LucideBookOpen, LucideBot, LucideCheck,
  LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideCircleQuestionMark, LucideClock, LucideCompass,
  LucideCopy, LucideCpu, LucideDownload, LucideEllipsis, LucideFile, LucideFolder, LucideFolderOpen, LucideGlobe2,
  LucideGraduationCap, LucideHouse, LucideInfo, LucideLibrary, LucideLogOut, LucideMenu, LucideMessageSquare,
  LucideMic, LucideMicOff, LucideOrigami, LucidePanelLeft,
  LucidePaperclip, LucidePencilLine, LucidePlugZap, LucidePlus, LucideRefreshCw, LucideRotateCcw,
  LucideSearch, LucideServer, LucideSettings2, LucideSparkles, LucideSquare, LucideSquarePen, LucideTerminal, LucideUploadCloud, LucideX, LucideZap
} from '@lucide/angular';
import { ManagerPanel } from './manager-panel';
import { MarkdownPipe } from './markdown.pipe';

type ProviderId = 'codex'|'antigravity';
export type ServiceId = 'auto' | 'gemini' | 'codex';
type ReasoningEffort = {id:string;label:string};
type Model = {id:string;label:string;reasoning?:ReasoningEffort[];defaultReasoning?:string};

export const DEFAULT_CODEX_MODELS: Model[] = [
  { id: 'default', label: 'По умолчанию Codex' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'o3', label: 'o3', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'o3-mini', label: 'o3-mini', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'o1', label: 'o1', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] }
];

export const DEFAULT_GEMINI_MODELS: Model[] = [
  { id: 'default', label: 'По умолчанию Gemini' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', defaultReasoning: 'high', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', defaultReasoning: 'high', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', defaultReasoning: 'high', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', defaultReasoning: 'high', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'high', label: 'Высокое' }] },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }, { id: 'max', label: 'Максимальное' }] },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-thinking', label: 'Gemini 2.5 Flash Thinking', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
];
type UsageWindow = {usedPercent:number;remainingPercent:number;windowMinutes:number|null;resetAt:string|null};
type Account = {id:string;provider:ProviderId;name:string;runnerId?:string;models:Model[];mode:'runner'|'offline'|'unassigned';auth:string;detail:string;limit:{source:'provider'|'unknown';primary:UsageWindow|null;secondary:UsageWindow|null;cooldownUntil:string|null;updatedAt:string|null}};
type Runner = {id:string;name:string;online:boolean;managementOnline:boolean;createdAt:string;revokedAt?:string};
type Project = {id:string;name:string;runnerId:string;createdAt:string;updatedAt:string};
type Preview = {subdomain:string;runnerId:string;visible:boolean;online:boolean;expired:boolean;url:string;createdAt:string;updatedAt:string;expiresAt:string};
type Pairing = {code:string;expiresAt:string};
type Message = {id:string;role:'user'|'assistant';text:string;at:string;provider?:ProviderId};
type ChatSession = {id:string;title:string;updatedAt:string;messages:Message[];projectId?:string};
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
    CommonModule, FormsModule, LucideArrowUp, LucideArrowUpRight, LucideAudioLines, LucideAudioWaveform, LucideBell, LucideBookOpen, LucideBot, LucideCheck,
    LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideCircleQuestionMark, LucideClock, LucideCompass, LucideCopy, LucideCpu, LucideDownload, LucideEllipsis,
    LucideFile, LucideFolder, LucideFolderOpen, LucideGlobe2, LucideGraduationCap, LucideHouse, LucideInfo, LucideLibrary, LucideLogOut, LucideMenu,
    LucideMessageSquare, LucideMic, LucideMicOff, LucideOrigami, LucidePanelLeft, LucidePaperclip, LucidePencilLine, LucidePlugZap, LucidePlus,
    LucideRefreshCw, LucideRotateCcw, LucideSearch, LucideServer, LucideSettings2, LucideSparkles, LucideSquare, LucideSquarePen, LucideTerminal, LucideUploadCloud, LucideX,
    LucideZap, ManagerPanel, MarkdownPipe
  ],
  templateUrl:'./app.html',
  styleUrl:'./app.css'
})
export class App implements OnInit,AfterViewInit,OnDestroy {
  username=''; password=''; loginName=''; loginError=''; registerMode=signal(false);
  loggedIn=signal(false); page=signal<'chat'|'projects'|'sites'|'providers'|'connections'|'runners'>('chat');
  mobileMenu=signal(false);
  managedRunner=signal<Runner|null>(null);
  modelBlacklist=signal<string[]>([]);
  accounts=signal<Account[]>([]); runners=signal<Runner[]>([]); projects=signal<Project[]>([]); previews=signal<Preview[]>([]); selectedProjectId=signal(''); pairing=signal<Pairing|null>(null); sessions=signal<ChatSession[]>([]); current=signal<ChatSession|null>(null);
  sidebarOpen = signal(true);
  mode = signal<'chat'|'work'>('chat');
  expandedProjects = signal<Set<string>>(new Set(['CCC-Solutions', 'Quest Control', 'proj-ccc', 'proj-quest']));
  pinnedChats = signal<{id: string; title: string}[]>([
    { id: 'pin-cat', title: 'кот' },
    { id: 'pin-yulia', title: 'юля' }
  ]);
  brandMenuOpen = signal(false);
  moreMenuOpen = signal(false);
  userMenuOpen = signal(false);
  helpModalOpen = signal(false);
  modelMenuOpen = signal(false);
  searchOpen = signal(false);
  sidebarSearch = signal('');
  isDemo = false;
  currentReasoningOrModelLabel = computed(() => {
    if (this.selectedReasoning && this.selectedReasoning !== 'default') {
      const r = this.selectedReasoning;
      return r.charAt(0).toUpperCase() + r.slice(1);
    }
    return 'High';
  });
  draft=''; selectedService=signal<ServiceId>('auto'); selectedAccount='auto'; selectedModel='default'; selectedReasoning='default';
  accountName=''; accountProvider:ProviderId='codex'; selectedRunner=''; runnerName='Мой компьютер'; notice=signal(''); error=signal('');
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
  models=computed(()=>{
    const service=this.selectedService();
    const allAccounts=this.accounts();
    const pId=this.current()?.projectId;
    const project=pId?this.projects().find(p=>p.id===pId):null;
    const scoped=project?allAccounts.filter(a=>a.runnerId===project.runnerId):allAccounts;
    const blacklist=new Set(this.modelBlacklist());

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
    return [...map.values()].filter(m=>m.id==='default'||!blacklist.has(m.id));
  });

  allGeminiModels=computed(()=>{
    const accModels=this.accounts().filter(a=>a.provider==='antigravity').flatMap(a=>a.models||[]);
    const map=new Map<string,Model>();
    for(const m of DEFAULT_GEMINI_MODELS)if(m.id!=='default')map.set(m.id,{...m});
    for(const m of accModels)if(m.id!=='default'&&!map.has(m.id))map.set(m.id,m);
    return [...map.values()];
  });

  allCodexModels=computed(()=>{
    const accModels=this.accounts().filter(a=>a.provider==='codex').flatMap(a=>a.models||[]);
    const map=new Map<string,Model>();
    for(const m of DEFAULT_CODEX_MODELS)if(m.id!=='default')map.set(m.id,{...m});
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

  totalModelsCount=computed(()=>this.allGeminiModels().length+this.allCodexModels().length);
  totalEnabledCount=computed(()=>this.geminiEnabledCount()+this.codexEnabledCount());
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
    const allIds=[...this.allGeminiModels().map(m=>m.id),...this.allCodexModels().map(m=>m.id)];
    await this.saveBlacklist(Array.from(new Set(allIds)));
  }

  async enableAllForProvider(provider:ProviderId){
    const models=provider==='antigravity'?this.allGeminiModels():this.allCodexModels();
    const idsToRemove=new Set(models.map(m=>m.id));
    const updated=this.modelBlacklist().filter(id=>!idsToRemove.has(id));
    await this.saveBlacklist(updated);
  }

  async disableAllForProvider(provider:ProviderId){
    const models=provider==='antigravity'?this.allGeminiModels():this.allCodexModels();
    const idsToAdd=models.map(m=>m.id);
    const updated=Array.from(new Set([...this.modelBlacklist(),...idsToAdd]));
    await this.saveBlacklist(updated);
  }

  async saveBlacklist(list:string[]){
    const previous=this.modelBlacklist();
    this.modelBlacklist.set(list);
    if(list.includes(this.selectedModel)){
      this.selectedModel='default';
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
      const [res]=await Promise.all([
        this.api<{blacklist:string[]}>('/user/model-blacklist'),
        this.refreshAccounts()
      ]);
      if(res?.blacklist){
        this.modelBlacklist.set(res.blacklist);
      }
      this.notice.set('Список моделей обновлен');
    }catch(e){
      if(this.page()==='providers')this.error.set((e as Error).message);
    }
  }

  reasoningOptions=computed(()=>{
    const currentModel=this.models().find(m=>m.id===this.selectedModel);
    const options=currentModel?.reasoning||[];
    return [{id:'default',label:'По умолчанию'},...options.filter(r=>r.id!=='default')];
  });
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
  async api<T>(path:string,options:RequestInit={}):Promise<T>{const r=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})},credentials:'same-origin'});const body=await r.json();if(!r.ok){const error=new Error(body.error||'Ошибка запроса') as Error&{status:number};error.status=r.status;throw error;}return body as T;}
  toggleSidebar() {
    this.sidebarOpen.update(v => !v);
  }

  setMode(m: 'chat' | 'work') {
    this.mode.set(m);
    if (m === 'chat') {
      this.showPage('chat');
    } else {
      this.showPage('projects');
    }
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

  openPinnedChat(title: string) {
    const s = this.sessions().find(x => x.title === title);
    if (s) {
      void this.openSession(s.id);
    } else {
      const newS: ChatSession = {
        id: 'pinned-' + Date.now(),
        title,
        updatedAt: new Date().toISOString(),
        messages: [
          { id: 'p1', role: 'user', text: `Привет, ${title}!`, at: '12:00' },
          { id: 'p2', role: 'assistant', text: `Привет! Чем могу помочь по теме «${title}»?`, at: '12:00' }
        ]
      };
      this.sessions.update(list => [newS, ...list]);
      this.current.set(newS);
      this.page.set('chat');
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

    const demoSessions: ChatSession[] = [
      {
        id: 'sess-krampus',
        title: 'Промо для Krampus Haus',
        updatedAt: new Date().toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Сделай промо-текст для Krampus Haus', at: '11:15' },
          { id: 'm2', role: 'assistant', text: 'Готовлю промо-материалы для мероприятия Krampus Haus...\n\n### 🔥 Krampus Haus: Зимний фестиваль\n* Погружение в атмосферу альпийского фольклора\n* Интерактивные зоны и шоу программа\n* Тематическая музыка и угощения', at: '11:16' }
        ]
      },
      {
        id: 'sess-backup-1',
        title: 'Daily Documents backup',
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Проверь статус ежедневного бэкапа документов', at: '10:00' },
          { id: 'm2', role: 'assistant', text: 'Все документы успешно синхронизированы в хранилище. Ошибок не обнаружено.', at: '10:01' }
        ]
      },
      {
        id: 'sess-backup-2',
        title: 'Daily Documents backup',
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
        messages: []
      },
      {
        id: 'sess-mower-1',
        title: 'Solve Classic Lawn Mower',
        projectId: 'proj-ccc',
        updatedAt: new Date(Date.now() - 172800000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Реши задачу Classic Lawn Mower для тура Cloudflight Coding Contest', at: '14:20' },
          { id: 'm2', role: 'assistant', text: 'Для задачи Classic Lawn Mower оптимальный алгоритм использует имитацию движения газонокосилки по сетке с отслеживанием скошенных клеток:\n\n```python\ndef solve_lawn_mower(grid, moves):\n    x, y = 0, 0\n    mowed = {(0, 0)}\n    directions = {"U": (0, -1), "D": (0, 1), "L": (-1, 0), "R": (1, 0)}\n    for move in moves:\n        dx, dy = directions[move]\n        x += dx\n        y += dy\n        mowed.add((x, y))\n    return len(mowed)\n```\nСложность: O(N) по времени и O(N) по памяти.', at: '14:21' }
        ]
      },
      {
        id: 'sess-mower-2',
        title: 'Solve Classic Lawn Mower',
        projectId: 'proj-ccc',
        updatedAt: new Date(Date.now() - 259200000).toISOString(),
        messages: []
      },
      {
        id: 'sess-clarify',
        title: 'Clarify the issue',
        projectId: 'proj-ccc',
        updatedAt: new Date(Date.now() - 300000000).toISOString(),
        messages: []
      },
      {
        id: 'sess-hu-pdf',
        title: 'Improve HÜ180926 PDF',
        projectId: 'proj-ccc',
        updatedAt: new Date(Date.now() - 320000000).toISOString(),
        messages: []
      },
      {
        id: 'sess-mcp-upload',
        title: 'Ускорить MCP upload и Tele...',
        projectId: 'proj-ccc',
        updatedAt: new Date(Date.now() - 340000000).toISOString(),
        messages: []
      },
      {
        id: 'sess-quest-check',
        title: 'Проверить локальные события',
        projectId: 'proj-quest',
        updatedAt: new Date(Date.now() - 350000000).toISOString(),
        messages: []
      },
      {
        id: 'sess-router-mvp',
        title: 'Создать MVP AI router',
        projectId: 'proj-ai-router',
        updatedAt: new Date(Date.now() - 360000000).toISOString(),
        messages: [
          { id: 'm1', role: 'user', text: 'Создай структуру проекта и маршрутизатор моделей', at: '09:30' },
          { id: 'm2', role: 'assistant', text: 'Архитектура AI Router разделена на:\n- `backend`: Express / WebSocket хаб\n- `runner`: изолированный процесс на клиенте с прямым доступом к Codex и Antigravity\n- `frontend`: Angular веб-интерфейс', at: '09:31' }
        ]
      }
    ];
    this.sessions.set(demoSessions);
    this.current.set(null);
  }

  async restore(){
    let me:{username:string};
    try{me=await this.api<{username:string}>('/me');}
    catch(e){
      return;
    }
    this.username=me.username;this.loggedIn.set(true);this.connect();
    try{await this.load();}catch(e){this.error.set((e as Error).message);}
  }
  async login(){this.loginError='';try{const me=await this.api<{username:string}>(this.registerMode()?'/register':'/login',{method:'POST',body:JSON.stringify({username:this.loginName,password:this.password})});this.isDemo=false;this.username=me.username;this.password='';this.loggedIn.set(true);await this.load();this.connect();}catch(e){this.loginError=(e as Error).message;}}
  async logout(){this.stopVoiceInput();if(!this.isDemo)await this.api('/logout',{method:'POST'}).catch(()=>{});this.isDemo=false;this.socket?.disconnect();this.managedRunner.set(null);this.modelBlacklist.set([]);this.loggedIn.set(false);this.current.set(null);}
  async load(){const [accounts,runners,projects,sessions,blacklistRes]=await Promise.all([this.api<Account[]>('/accounts'),this.api<Runner[]>('/runners'),this.api<Project[]>('/projects'),this.api<ChatSession[]>('/sessions'),this.api<{blacklist:string[]}>('/user/model-blacklist').catch(()=>({blacklist:[]}))]);this.accounts.set(accounts);this.runners.set(runners);this.projects.set(projects);if(blacklistRes?.blacklist){this.modelBlacklist.set(blacklistRes.blacklist);}const available=this.models();if(!available.some(m=>m.id===this.selectedModel))this.selectedModel='default';this.validateReasoning();this.selectedRunner=runners.find(r=>!r.revokedAt)?.id||'';this.sessions.set(sessions);void this.refreshPreviews();if(sessions.length)await this.openSession(sessions[0].id);else {if(projects.length)this.selectedProjectId.set(projects[0].id);await this.newSession();}if(!runners.some(r=>!r.revokedAt))this.page.set('runners');}
  async refreshAccounts(){this.accounts.set(await this.api<Account[]>('/accounts'));}
  async refreshRunners(){const rows=await this.api<Runner[]>('/runners');this.runners.set(rows);const managed=this.managedRunner();if(managed)this.managedRunner.set(rows.find(row=>row.id===managed.id)||null);await this.refreshAccounts();if(!this.selectedRunner)this.selectedRunner=this.runners().find(r=>!r.revokedAt)?.id||'';}
  async newSession(){
    this.stopVoiceInput();
    this.mobileMenu.set(false);
    if(this.isDemo){
      this.current.set(null);
      this.taskFiles.set([]);
      this.sharedFileLinks.set({});
      this.collapsedDirs.set(new Set());
      this.filesFilter.set('');
      this.filesOpen.set(false);
      this.page.set('chat');
      this.resetRun();
      this.error.set('');
      this.ensureChatScrollAttached(true);
      return;
    }
    try{
      const projectId=this.selectedProjectId()||undefined;
      const s=await this.api<ChatSession>('/sessions',{method:'POST',body:JSON.stringify(projectId?{projectId}:{})});
      this.sessions.update(v=>[s,...v]);
      this.current.set(s);
      this.taskFiles.set([]);
      this.sharedFileLinks.set({});
      this.collapsedDirs.set(new Set());
      this.filesFilter.set('');
      this.filesOpen.set(false);
      this.selectedProjectId.set(s.projectId||'');
      this.page.set('chat');
      this.resetRun();
      this.error.set('');
      this.syncRun(s.id);
      this.ensureChatScrollAttached(true);
    }catch(e){this.error.set((e as Error).message);}
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
  chatsFor(projectId?:string){return this.sessions().filter(s=>projectId?s.projectId===projectId:!s.projectId);}
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
    const realChats = this.chatsFor(p.id);
    if (realChats.length) return realChats;
    if (p.name === 'CCC-Solutions' || p.id === 'proj-ccc') {
      return this.sessions().filter(s => s.projectId === 'proj-ccc' || s.title.includes('Lawn Mower') || s.title.includes('Clarify') || s.title.includes('HÜ180926') || s.title.includes('MCP upload'));
    }
    if (p.name === 'Quest Control' || p.id === 'proj-quest') {
      return this.sessions().filter(s => s.projectId === 'proj-quest' || s.title.includes('локальные события'));
    }
    if (p.name === 'AI Router' || p.id === 'proj-ai-router') {
      return this.sessions().filter(s => s.projectId === 'proj-ai-router' || s.title.includes('MVP AI router'));
    }
    return [];
  }

  filteredRecentSessions = computed(() => {
    const query = this.sidebarSearch().trim().toLowerCase();
    const all = this.sessions();
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
  selectProject(id:string){this.selectedProjectId.set(id);this.page.set('projects');this.mobileMenu.set(false);}
  newSessionFor(projectId:string){this.selectedProjectId.set(projectId);this.newSession();}
  async createProject(){const name=window.prompt('Название проекта');if(!name?.trim())return;const runnerId=this.selectedRunner||this.runners().find(r=>!r.revokedAt)?.id;if(!runnerId){this.error.set('Сначала подключите исполнитель');return;}try{const project=await this.api<Project>('/projects',{method:'POST',body:JSON.stringify({name:name.trim(),runnerId})});this.projects.update(v=>[project,...v]);this.selectedProjectId.set(project.id);this.notice.set(`Проект «${project.name}» создан`);await this.newSession();}catch(e){this.error.set((e as Error).message);}}
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
  showPage(page:'chat'|'projects'|'sites'|'providers'|'connections'|'runners'){this.stopVoiceInput();this.page.set(page);this.mobileMenu.set(false);if(page==='runners')this.refreshRunners();else this.managedRunner.set(null);if(page==='sites')void this.refreshPreviews();if(page==='providers')void this.refreshProviders();if(page==='chat')this.ensureChatScrollAttached(true);else this.cleanupResizeObserver();}
  async refreshPreviews(){try{const rows=await Promise.all(this.runners().filter(r=>!r.revokedAt).map(r=>this.api<Preview[]>('/runners/'+r.id+'/previews')));this.previews.set(rows.flat().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}catch(e){if(this.page()==='sites')this.error.set((e as Error).message);}}
  async setPreviewVisible(preview:Preview,visible:boolean){try{await this.api('/runners/'+preview.runnerId+'/previews/'+preview.subdomain,{method:'PATCH',body:JSON.stringify({visible})});await this.refreshPreviews();this.notice.set(visible?'Сайт открыт':'Сайт скрыт');}catch(e){this.error.set((e as Error).message);}}
  previewRunner(preview:Preview){return this.runners().find(r=>r.id===preview.runnerId)?.name||'Runner';}
  connect(){this.socket?.disconnect();this.socket=io({path:'/socket.io',transports:['websocket']});this.socket.on('connect',()=>{if(this.error()==='Соединение с сервером потеряно')this.error.set('');const id=this.current()?.id;if(id)this.syncRun(id);});this.socket.on('disconnect',()=>{if(this.running())this.notice.set('Соединение потеряно. Восстанавливаем статус задачи…');});this.socket.on('ai:event',(e:AIEvent)=>this.onEvent(e));this.socket.on('accounts:changed',(a:Account[])=>{this.accounts.set(a);const available=this.models();if(!available.some(m=>m.id===this.selectedModel))this.selectedModel='default';this.validateReasoning();});this.socket.on('connect_error',()=>this.error.set('Соединение с сервером потеряно'));}
  resetRun(){this.running.set(false);this.runId.set('');this.stream.set('');this.activeAccount.set('');this.activeProvider.set(undefined);this.activity.set([]);this.runStartedAt.set('');}
  syncRun(sessionId:string){if(!this.socket?.connected)return;this.socket.emit('run:state',sessionId,(state:RunState|null)=>{if(this.current()?.id!==sessionId)return;if(!state){const wasRunning=this.running();this.resetRun();this.notice.set('');if(wasRunning)this.error.set('Соединение восстановлено, но статус задачи недоступен. Обновите чат или повторите запрос.');void this.reloadCurrent();return;}if('type' in state){const wasRunning=this.running()||this.runId()===state.runId;this.resetRun();this.notice.set('');if(wasRunning){if(state.type==='error')this.error.set(state.message);else{this.error.set('');this.notice.set(state.message||'Готово');}}void this.reloadCurrent();return;}this.runId.set(state.runId);this.running.set(true);this.runStartedAt.set(state.startedAt);this.activeAccount.set(state.accountId||'');if(state.provider)this.activeProvider.set(state.provider);this.stream.set(state.stream||'');this.activity.set(state.activity||[]);this.notice.set(state.message||'Задача выполняется');this.error.set('');this.requestScrollToBottom();});}
  onEvent(e:AIEvent){if(e.sessionId!==this.current()?.id)return;if(e.provider)this.activeProvider.set(e.provider as ProviderId);if(e.type==='started'){this.running.set(true);this.runId.set(e.runId);this.runStartedAt.set(new Date().toISOString());this.activity.set([]);this.notice.set(e.message||'Запрос принят');this.requestScrollToBottom();}else if(e.type==='delta'){this.stream.update(s=>s+(e.text||''));this.activeAccount.set(e.data?.accountId||'');this.requestScrollToBottom();}else if(e.type==='status'||e.type==='tool'||e.type==='fallback'||e.type==='checkpoint'||e.type==='handoff_started'||e.type==='handoff_ready'){if(e.type==='handoff_started')this.stream.set('');if(e.message){this.notice.set(e.message);this.activity.update(rows=>[...rows,{type:e.type,message:e.message!,at:new Date().toISOString(),provider:e.provider as ProviderId,accountId:e.data?.accountId}].slice(-12));}this.activeAccount.set(e.data?.accountId||this.activeAccount());this.requestScrollToBottom();}else if(e.type==='error'){this.error.set(e.message||'Ошибка');this.resetRun();this.reloadCurrent();}else if(e.type==='completed'){this.resetRun();this.notice.set(e.message||'Готово');this.reloadCurrent();void this.refreshTaskFiles();}}
  async reloadCurrent(){const id=this.current()?.id;if(!id)return;const s=await this.api<ChatSession>('/sessions/'+id);this.current.set(s);this.sessions.update(list=>[s,...list.filter(x=>x.id!==s.id)]);this.requestScrollToBottom();}
  send(){
    if(this.isRecording())this.stopVoiceInput();
    const prompt=this.draft.trim();
    if(!prompt||this.running())return;

    let s=this.current();
    if(!s && this.isDemo){
      s = {
        id: 'sess-' + Date.now(),
        title: prompt.length > 28 ? prompt.slice(0, 28) + '...' : prompt,
        updatedAt: new Date().toISOString(),
        messages: []
      };
      this.sessions.update(list => [s!, ...list]);
      this.current.set(s);
    }

    if(!s){
      this.error.set('Создайте новый чат и повторите запрос');
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
    this.error.set('');this.notice.set('');this.stream.set('');this.activity.set([]);this.runStartedAt.set(new Date().toISOString());this.running.set(true);this.draft='';setTimeout(()=>this.adjustTextareaHeight(),0);this.userScrolledUp.set(false);this.showScrollBottom.set(false);this.isSmoothScrollingToBottom=false;this.current.update(x=>x?{...x,messages:[...x.messages,{id:'pending',role:'user',text:prompt,at:new Date().toISOString()}]}:x);
    this.scrollToBottom(true,'auto');
    requestAnimationFrame(()=>this.scrollToBottom(true,'auto'));
    this.socket?.emit('run',{sessionId:s.id,prompt,service:this.selectedService(),accountId:this.selectedService(),model:this.selectedModel,reasoning:this.selectedReasoning,mode:'task'},(ack:{ok:boolean;runId?:string;error?:string})=>{if(ack.ok){this.runId.set(ack.runId||'');this.requestScrollToBottom(true);}else{this.resetRun();this.error.set(ack.error||'Ошибка');this.draft=prompt;this.reloadCurrent();if(ack.error==='Этот чат уже занят')this.syncRun(s.id);}});
  }

  sendDemoMessage(prompt: string, s: ChatSession) {
    this.error.set('');
    this.notice.set('');
    this.stream.set('');
    this.activity.set([]);
    this.runStartedAt.set(new Date().toISOString());
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
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    this.current.update(x => x ? { ...x, messages: [...x.messages, userMsg] } : x);
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
        const assistantMsg: Message = {
          id: 'a-' + Date.now(),
          role: 'assistant',
          text: fullText,
          at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        this.current.update(x => x ? { ...x, messages: [...x.messages, assistantMsg] } : x);
        this.scrollToBottom(true, 'smooth');
      } else {
        this.stream.set(fullText.slice(0, index));
        this.requestScrollToBottom();
      }
    }, 35);
  }
  cancel(){if(this.runId())this.socket?.emit('cancel',this.runId());}
  elapsed(){const start=Date.parse(this.runStartedAt());if(!Number.isFinite(start))return '0:00';const seconds=Math.max(0,Math.floor((this.now()-start)/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
  async addAccount(){this.error.set('');try{await this.api('/accounts',{method:'POST',body:JSON.stringify({provider:this.accountProvider,name:this.accountName,runnerId:this.selectedRunner})});this.accountName='';await this.refreshAccounts();this.notice.set('Аккаунт добавлен. Выполните команду входа на своём контейнере.');}catch(e){this.error.set((e as Error).message);}}
  async assignAccount(a:Account,runnerId:string){try{await this.api('/accounts/'+a.id,{method:'PATCH',body:JSON.stringify({runnerId})});await this.refreshAccounts();}catch(e){this.error.set((e as Error).message);}}
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
  providerLabel(id?:ProviderId|string){return id==='codex'?'Codex':(id==='antigravity'||id==='gemini')?'Gemini':'';}
  limitLabel(a:Account){if(a.limit.cooldownUntil)return 'Ограничен';if(a.limit.primary||a.limit.secondary)return 'Квота аккаунта';return 'Провайдер';}
  windowLabel(window:UsageWindow){const minutes=window.windowMinutes;if(minutes===300)return '5 ч';if(minutes===10080)return 'Неделя';if(minutes===43200)return 'Месяц';if(minutes&&minutes%60===0)return `${minutes/60} ч`;return 'Окно';}
  remaining(window:UsageWindow|null){return window?`${Math.round(window.remainingPercent)}%`:'';}
  resetLabel(window:UsageWindow){if(!window.resetAt)return '';const date=new Date(window.resetAt);return Number.isFinite(date.getTime())?`Сброс ${new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(date)}`:'';}
  accountMode(a:Account){return a.mode==='runner'?'Контейнер в сети':a.mode==='offline'?'Не в сети':'Без контейнера';}
  hasAccountsFor(service:ServiceId):boolean{if(service==='auto')return this.accounts().length>0;const provider:ProviderId=service==='gemini'?'antigravity':'codex';const pId=this.current()?.projectId;const project=pId?this.projects().find(p=>p.id===pId):null;const list=project?this.accounts().filter(a=>a.runnerId===project.runnerId):this.accounts();return list.some(a=>a.provider===provider);}
  selectService(service:ServiceId){this.selectedService.set(service);this.selectedAccount=service;const available=this.models();if(!available.some(m=>m.id===this.selectedModel))this.selectedModel='default';this.validateReasoning();}
  selectAccount(id:string){this.selectedAccount=id;this.selectedModel='default';this.selectedReasoning='default';}
  selectModel(id:string){this.selectedModel=id;this.validateReasoning();}
  validateReasoning(){const currentModel=this.models().find(m=>m.id===this.selectedModel);const reasoningExists=currentModel?.reasoning?.some(r=>r.id===this.selectedReasoning);if(this.selectedReasoning!=='default'&&!reasoningExists)this.selectedReasoning='default';}
  currentRunnerLabel():string{const name=this.accountLabel(this.activeAccount());if(name)return name;const prov=this.activeProvider();if(prov)return this.providerLabel(prov);const s=this.selectedService();return s==='gemini'?'Gemini':s==='codex'?'Codex':'AI Router';}

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
