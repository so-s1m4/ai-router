import { Component, OnInit, AfterViewInit, OnDestroy, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { io, Socket } from 'socket.io-client';
import { 
  LucideArrowUp, LucideArrowUpRight, LucideBot, LucideCheck, LucideChevronDown, 
  LucideCopy, LucideFolder, LucideGlobe2, LucideInfo, LucideLogOut, LucideMenu, LucideMessageSquare,
  LucideMic, LucideMicOff,
  LucidePaperclip, LucidePencilLine, LucidePlugZap, LucidePlus, LucideRefreshCw, 
  LucideServer, LucideSettings2, LucideSparkles, LucideSquare, LucideUploadCloud, LucideX, LucideZap 
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

@Component({
  selector:'app-root',
  standalone:true,
  imports:[
    CommonModule, FormsModule, LucideArrowUp, LucideArrowUpRight, LucideBot, LucideCheck, 
    LucideChevronDown, LucideCopy, LucideFolder, LucideGlobe2, LucideInfo, LucideLogOut, LucideMenu,
    LucideMessageSquare, LucideMic, LucideMicOff, LucidePaperclip, LucidePencilLine, LucidePlugZap, LucidePlus, 
    LucideRefreshCw, LucideServer, LucideSettings2, LucideSparkles, LucideSquare, LucideUploadCloud, LucideX, 
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
  draft=''; selectedService=signal<ServiceId>('auto'); selectedAccount='auto'; selectedModel='default'; selectedReasoning='default'; runMode:'chat'|'task'='chat';
  accountName=''; accountProvider:ProviderId='codex'; selectedRunner=''; runnerName='Мой компьютер'; notice=signal(''); error=signal('');
  running=signal(false); uploading=signal(false); runId=signal(''); stream=signal(''); activeAccount=signal(''); activeProvider=signal<ProviderId|undefined>(undefined); activity=signal<RunActivity[]>([]); runStartedAt=signal(''); now=signal(Date.now());
  socket?:Socket;
  private clock?:ReturnType<typeof setInterval>;
  copiedId=signal<string>('');
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
  private scrollRaf?: number;
  private touchStartY = 0;
  private isProgrammaticScroll = false;
  private onViewportResize = () => {
    if (!this.userScrolledUp()) this.requestScrollToBottom();
  };

  ngAfterViewInit() {
    setTimeout(() => this.scrollToBottom(true, 'auto'), 50);
  }

  onTouchStart(event: TouchEvent) {
    this.isProgrammaticScroll = false;
    if (event.touches.length === 1) {
      this.touchStartY = event.touches[0].clientY;
    }
  }

  onTouchMove(event: TouchEvent) {
    if (event.touches.length === 1) {
      const currentY = event.touches[0].clientY;
      // Moving finger down (currentY > touchStartY) scrolls view UP
      if (currentY - this.touchStartY > 8) {
        this.userScrolledUp.set(true);
        this.showScrollBottom.set(true);
      }
    }
  }

  onWheel(event: WheelEvent) {
    this.isProgrammaticScroll = false;
    if (event.deltaY < 0) {
      this.userScrolledUp.set(true);
      this.showScrollBottom.set(true);
    }
  }

  onChatScroll() {
    if (this.isProgrammaticScroll) return;

    const el = this.chatScrollArea?.nativeElement;
    if (!el) return;

    const currentScrollTop = el.scrollTop;
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const distanceFromBottom = Math.max(0, scrollHeight - currentScrollTop - clientHeight);

    const isAtBottom = distanceFromBottom <= 40;

    if (isAtBottom) {
      this.userScrolledUp.set(false);
      this.showScrollBottom.set(false);
    } else {
      this.userScrolledUp.set(true);
      this.showScrollBottom.set(true);
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
      this.isProgrammaticScroll = true;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      setTimeout(() => {
        this.isProgrammaticScroll = false;
      }, 400);
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }

  requestScrollToBottom(force = false, behavior: ScrollBehavior = 'auto') {
    if (!force && this.userScrolledUp()) return;
    if (this.scrollRaf) {
      cancelAnimationFrame(this.scrollRaf);
    }
    this.scrollRaf = requestAnimationFrame(() => {
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
    if(typeof window !== 'undefined'){
      window.removeEventListener('dragover', this.preventWindowDrop);
      window.removeEventListener('drop', this.preventWindowDrop);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.onViewportResize);
      }
    }
  }
  async api<T>(path:string,options:RequestInit={}):Promise<T>{const r=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})},credentials:'same-origin'});const body=await r.json();if(!r.ok){const error=new Error(body.error||'Ошибка запроса') as Error&{status:number};error.status=r.status;throw error;}return body as T;}
  async restore(){
    let me:{username:string};
    try{me=await this.api<{username:string}>('/me');}
    catch(e){
      if((e as Error&{status?:number}).status===401)this.loggedIn.set(false);
      else this.loginError='Не удалось проверить вход. Обновите страницу.';
      return;
    }
    this.username=me.username;this.loggedIn.set(true);this.connect();
    try{await this.load();}catch(e){this.error.set((e as Error).message);}
  }
  async login(){this.loginError='';try{const me=await this.api<{username:string}>(this.registerMode()?'/register':'/login',{method:'POST',body:JSON.stringify({username:this.loginName,password:this.password})});this.username=me.username;this.password='';this.loggedIn.set(true);await this.load();this.connect();}catch(e){this.loginError=(e as Error).message;}}
  async logout(){this.stopVoiceInput();await this.api('/logout',{method:'POST'});this.socket?.disconnect();this.managedRunner.set(null);this.loggedIn.set(false);this.current.set(null);}
  async load(){const [accounts,runners,projects,sessions]=await Promise.all([this.api<Account[]>('/accounts'),this.api<Runner[]>('/runners'),this.api<Project[]>('/projects'),this.api<ChatSession[]>('/sessions')]);this.accounts.set(accounts);this.runners.set(runners);this.projects.set(projects);this.selectedRunner=runners.find(r=>!r.revokedAt)?.id||'';this.sessions.set(sessions);void this.refreshPreviews();if(sessions.length)await this.openSession(sessions[0].id);else {if(projects.length)this.selectedProjectId.set(projects[0].id);await this.newSession();}if(!runners.some(r=>!r.revokedAt))this.page.set('runners');}
  async refreshAccounts(){this.accounts.set(await this.api<Account[]>('/accounts'));}
  async refreshRunners(){const rows=await this.api<Runner[]>('/runners');this.runners.set(rows);const managed=this.managedRunner();if(managed)this.managedRunner.set(rows.find(row=>row.id===managed.id)||null);await this.refreshAccounts();if(!this.selectedRunner)this.selectedRunner=this.runners().find(r=>!r.revokedAt)?.id||'';}
  async newSession(){this.stopVoiceInput();this.mobileMenu.set(false);try{const projectId=this.selectedProjectId()||undefined;const s=await this.api<ChatSession>('/sessions',{method:'POST',body:JSON.stringify(projectId?{projectId}:{})});this.sessions.update(v=>[s,...v]);this.current.set(s);this.selectedProjectId.set(s.projectId||'');this.page.set('chat');this.resetRun();this.error.set('');this.syncRun(s.id);setTimeout(()=>this.scrollToBottom(true,'auto'),50);}catch(e){this.error.set((e as Error).message);}}
  async openSession(id:string){this.stopVoiceInput();this.mobileMenu.set(false);try{const s=await this.api<ChatSession>('/sessions/'+id);this.current.set(s);this.selectedProjectId.set(s.projectId||'');this.resetRun();this.error.set('');this.page.set('chat');this.syncRun(id);setTimeout(()=>this.scrollToBottom(true,'auto'),50);}catch(e){this.error.set((e as Error).message);}}
  chatsFor(projectId?:string){return this.sessions().filter(s=>projectId?s.projectId===projectId:!s.projectId);}
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
  showPage(page:'chat'|'projects'|'sites'|'connections'|'runners'){this.stopVoiceInput();this.page.set(page);this.mobileMenu.set(false);if(page==='runners')this.refreshRunners();else this.managedRunner.set(null);if(page==='sites')void this.refreshPreviews();if(page==='chat')setTimeout(()=>this.scrollToBottom(true,'auto'),50);}
  async refreshPreviews(){try{const rows=await Promise.all(this.runners().filter(r=>!r.revokedAt).map(r=>this.api<Preview[]>('/runners/'+r.id+'/previews')));this.previews.set(rows.flat().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}catch(e){if(this.page()==='sites')this.error.set((e as Error).message);}}
  async setPreviewVisible(preview:Preview,visible:boolean){try{await this.api('/runners/'+preview.runnerId+'/previews/'+preview.subdomain,{method:'PATCH',body:JSON.stringify({visible})});await this.refreshPreviews();this.notice.set(visible?'Сайт открыт':'Сайт скрыт');}catch(e){this.error.set((e as Error).message);}}
  previewRunner(preview:Preview){return this.runners().find(r=>r.id===preview.runnerId)?.name||'Runner';}
  connect(){this.socket?.disconnect();this.socket=io({path:'/socket.io',transports:['websocket']});this.socket.on('connect',()=>{if(this.error()==='Соединение с сервером потеряно')this.error.set('');const id=this.current()?.id;if(id)this.syncRun(id);});this.socket.on('disconnect',()=>{if(this.running())this.notice.set('Соединение потеряно. Восстанавливаем статус задачи…');});this.socket.on('ai:event',(e:AIEvent)=>this.onEvent(e));this.socket.on('accounts:changed',(a:Account[])=>{this.accounts.set(a);const available=this.models();if(!available.some(m=>m.id===this.selectedModel))this.selectedModel='default';this.validateReasoning();});this.socket.on('connect_error',()=>this.error.set('Соединение с сервером потеряно'));}
  resetRun(){this.running.set(false);this.runId.set('');this.stream.set('');this.activeAccount.set('');this.activeProvider.set(undefined);this.activity.set([]);this.runStartedAt.set('');}
  syncRun(sessionId:string){if(!this.socket?.connected)return;this.socket.emit('run:state',sessionId,(state:RunState|null)=>{if(this.current()?.id!==sessionId)return;if(!state){const wasRunning=this.running();this.resetRun();this.notice.set('');if(wasRunning)this.error.set('Соединение восстановлено, но статус задачи недоступен. Обновите чат или повторите запрос.');void this.reloadCurrent();return;}if('type' in state){const wasRunning=this.running()||this.runId()===state.runId;this.resetRun();this.notice.set('');if(wasRunning){if(state.type==='error')this.error.set(state.message);else{this.error.set('');this.notice.set(state.message||'Готово');}}void this.reloadCurrent();return;}this.runId.set(state.runId);this.running.set(true);this.runStartedAt.set(state.startedAt);this.activeAccount.set(state.accountId||'');if(state.provider)this.activeProvider.set(state.provider);this.stream.set(state.stream||'');this.activity.set(state.activity||[]);this.notice.set(state.message||'Задача выполняется');this.error.set('');this.requestScrollToBottom();});}
  onEvent(e:AIEvent){if(e.sessionId!==this.current()?.id)return;if(e.provider)this.activeProvider.set(e.provider as ProviderId);if(e.type==='started'){this.running.set(true);this.runId.set(e.runId);this.runStartedAt.set(new Date().toISOString());this.activity.set([]);this.notice.set(e.message||'Запрос принят');this.requestScrollToBottom();}else if(e.type==='delta'){this.stream.update(s=>s+(e.text||''));this.activeAccount.set(e.data?.accountId||'');this.requestScrollToBottom();}else if(e.type==='status'||e.type==='tool'||e.type==='fallback'||e.type==='checkpoint'||e.type==='handoff_started'||e.type==='handoff_ready'){if(e.type==='handoff_started')this.stream.set('');if(e.message){this.notice.set(e.message);this.activity.update(rows=>[...rows,{type:e.type,message:e.message!,at:new Date().toISOString(),provider:e.provider as ProviderId,accountId:e.data?.accountId}].slice(-12));}this.activeAccount.set(e.data?.accountId||this.activeAccount());this.requestScrollToBottom();}else if(e.type==='error'){this.error.set(e.message||'Ошибка');this.resetRun();this.reloadCurrent();}else if(e.type==='completed'){this.resetRun();this.notice.set(e.message||'Готово');this.reloadCurrent();}}
  async reloadCurrent(){const id=this.current()?.id;if(!id)return;const s=await this.api<ChatSession>('/sessions/'+id);this.current.set(s);this.sessions.update(list=>[s,...list.filter(x=>x.id!==s.id)]);this.requestScrollToBottom();}
  send(){if(this.isRecording())this.stopVoiceInput();const prompt=this.draft.trim(),s=this.current();if(!prompt||!s||this.running())return;if(!this.socket?.connected){this.error.set('Соединение с сервером потеряно');return;}this.error.set('');this.notice.set('');this.stream.set('');this.activity.set([]);this.runStartedAt.set(new Date().toISOString());this.running.set(true);this.draft='';setTimeout(()=>this.adjustTextareaHeight(),0);this.current.update(x=>x?{...x,messages:[...x.messages,{id:'pending',role:'user',text:prompt,at:new Date().toISOString()}]}:x);
    this.scrollToBottom(true,'smooth');
    this.socket?.emit('run',{sessionId:s.id,prompt,service:this.selectedService(),accountId:this.selectedService(),model:this.selectedModel,reasoning:this.selectedReasoning,mode:this.runMode},(ack:{ok:boolean;runId?:string;error?:string})=>{if(ack.ok){this.runId.set(ack.runId||'');this.requestScrollToBottom(true);}else{this.resetRun();this.error.set(ack.error||'Ошибка');this.draft=prompt;this.reloadCurrent();if(ack.error==='Этот чат уже занят')this.syncRun(s.id);}});
  }
  cancel(){if(this.runId())this.socket?.emit('cancel',this.runId());}
  elapsed(){const start=Date.parse(this.runStartedAt());if(!Number.isFinite(start))return '0:00';const seconds=Math.max(0,Math.floor((this.now()-start)/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
  async addAccount(){this.error.set('');try{await this.api('/accounts',{method:'POST',body:JSON.stringify({provider:this.accountProvider,name:this.accountName,runnerId:this.selectedRunner})});this.accountName='';await this.refreshAccounts();this.notice.set('Аккаунт добавлен. Выполните команду входа на своём контейнере.');}catch(e){this.error.set((e as Error).message);}}
  async assignAccount(a:Account,runnerId:string){try{await this.api('/accounts/'+a.id,{method:'PATCH',body:JSON.stringify({runnerId})});await this.refreshAccounts();}catch(e){this.error.set((e as Error).message);}}
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
  toggleRunMode(){this.runMode=this.runMode==='chat'?'task':'chat';}

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

  adjustTextareaHeight() {
    const el = this.composerTextareaRef?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
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
