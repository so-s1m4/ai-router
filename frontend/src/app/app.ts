import { Component, OnInit, OnDestroy, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { io, Socket } from 'socket.io-client';
import { 
  LucideArrowUp, LucideArrowUpRight, LucideBot, LucideCheck, LucideChevronDown, 
  LucideCopy, LucideFolder, LucideGlobe2, LucideInfo, LucideLogOut, LucideMenu, LucideMessageSquare,
  LucidePaperclip, LucidePencilLine, LucidePlugZap, LucidePlus, LucideRefreshCw, 
  LucideServer, LucideSettings2, LucideSparkles, LucideSquare, LucideX, LucideZap 
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
type RunState = {runId:string;sessionId:string;startedAt:string;accountId?:string;provider?:ProviderId;message:string;stream:string;activity:RunActivity[]};

@Component({
  selector:'app-root',
  standalone:true,
  imports:[
    CommonModule, FormsModule, LucideArrowUp, LucideArrowUpRight, LucideBot, LucideCheck, 
    LucideChevronDown, LucideCopy, LucideFolder, LucideGlobe2, LucideInfo, LucideLogOut, LucideMenu,
    LucideMessageSquare, LucidePaperclip, LucidePencilLine, LucidePlugZap, LucidePlus, 
    LucideRefreshCw, LucideServer, LucideSettings2, LucideSparkles, LucideSquare, LucideX, 
    LucideZap, ManagerPanel, MarkdownPipe
  ],
  templateUrl:'./app.html',
  styleUrl:'./app.css'
})
export class App implements OnInit,OnDestroy {
  username=''; password=''; loginName=''; loginError=''; registerMode=signal(false);
  loggedIn=signal(false); page=signal<'chat'|'projects'|'sites'|'connections'|'runners'>('chat');
  mobileMenu=signal(false);
  managedRunner=signal<Runner|null>(null);
  accounts=signal<Account[]>([]); runners=signal<Runner[]>([]); projects=signal<Project[]>([]); previews=signal<Preview[]>([]); selectedProjectId=signal(''); pairing=signal<Pairing|null>(null); sessions=signal<ChatSession[]>([]); current=signal<ChatSession|null>(null);
  draft=''; selectedService=signal<ServiceId>('auto'); selectedAccount='auto'; selectedModel='default'; selectedReasoning='default'; runMode:'chat'|'task'='chat';
  accountName=''; accountProvider:ProviderId='codex'; selectedRunner=''; runnerName='Мой компьютер'; notice=signal(''); error=signal('');
  running=signal(false); uploading=signal(false); runId=signal(''); stream=signal(''); activeAccount=signal(''); activeProvider=signal<ProviderId|undefined>(undefined); activity=signal<RunActivity[]>([]); runStartedAt=signal(''); now=signal(Date.now());
  socket?:Socket;
  private clock?:ReturnType<typeof setInterval>;
  copiedId=signal<string>('');

  userScrolledUp = signal(false);
  showScrollBottom = signal(false);
  private chatScrollArea?: ElementRef<HTMLDivElement>;
  private isAutoScrolling = false;
  private autoScrollTimeout?: ReturnType<typeof setTimeout>;
  private scrollRaf?: number;
  private resizeObserver?: ResizeObserver;
  private onViewportResize = () => {
    if (!this.userScrolledUp()) this.requestScrollToBottom();
  };

  @ViewChild('chatScrollArea') set chatScrollAreaRef(ref: ElementRef<HTMLDivElement> | undefined) {
    this.chatScrollArea = ref;
    if (ref) {
      this.setupScrollObserver();
      this.scrollToBottom(true, 'auto');
    } else {
      this.cleanupScrollObserver();
    }
  }

  onUserScrollInteraction() {
    if (this.isAutoScrolling) {
      this.isAutoScrolling = false;
      if (this.autoScrollTimeout) {
        clearTimeout(this.autoScrollTimeout);
        this.autoScrollTimeout = undefined;
      }
    }
  }

  onChatScroll() {
    if (this.isAutoScrolling) return;
    const el = this.chatScrollArea?.nativeElement;
    if (!el) return;

    const distanceFromBottom = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
    const isUp = distanceFromBottom > 30;
    this.userScrolledUp.set(isUp);
    this.showScrollBottom.set(isUp);
  }

  scrollToBottom(force = false, behavior: ScrollBehavior = 'auto') {
    if (force) {
      this.userScrolledUp.set(false);
      this.showScrollBottom.set(false);
      this.isAutoScrolling = true;
      if (this.autoScrollTimeout) clearTimeout(this.autoScrollTimeout);
      this.autoScrollTimeout = setTimeout(() => {
        this.isAutoScrolling = false;
      }, behavior === 'smooth' ? 300 : 50);
    }
    if (!force && this.userScrolledUp()) {
      return;
    }
    const el = this.chatScrollArea?.nativeElement;
    if (!el) return;

    if (behavior === 'smooth') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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

  private setupScrollObserver() {
    this.cleanupScrollObserver();
    const el = this.chatScrollArea?.nativeElement;
    if (!el) return;

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.userScrolledUp()) {
          this.requestScrollToBottom();
        }
      });
      const feed = el.querySelector('.message-feed');
      if (feed) {
        this.resizeObserver.observe(feed);
      }
    }
  }

  private cleanupScrollObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
    if (this.scrollRaf) {
      cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = undefined;
    }
  }

  currentProject=computed(()=>{const pId=this.current()?.projectId;return pId?this.projects().find(p=>p.id===pId):null;});
  models=computed(()=>{
    const service=this.selectedService();
    const allAccounts=this.accounts();
    const pId=this.current()?.projectId;
    const project=pId?this.projects().find(p=>p.id===pId):null;
    const scoped=project?allAccounts.filter(a=>a.runnerId===project.runnerId):allAccounts;

    if(service==='gemini'){
      const accModels=scoped.filter(a=>a.provider==='antigravity').flatMap(a=>a.models||[]);
      const map=new Map<string,Model>();
      for(const m of DEFAULT_GEMINI_MODELS)map.set(m.id,{...m});
      for(const m of accModels)if(m.id!=='default')map.set(m.id,m);
      map.set('default',{id:'default',label:'По умолчанию Gemini'});
      return [...map.values()];
    }

    if(service==='codex'){
      const accModels=scoped.filter(a=>a.provider==='codex').flatMap(a=>a.models||[]);
      const map=new Map<string,Model>();
      for(const m of DEFAULT_CODEX_MODELS)map.set(m.id,{...m});
      for(const m of accModels)if(m.id!=='default')map.set(m.id,m);
      map.set('default',{id:'default',label:'По умолчанию Codex'});
      return [...map.values()];
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
    return [...map.values()];
  });
  reasoningOptions=computed(()=>{
    const currentModel=this.models().find(m=>m.id===this.selectedModel);
    const options=currentModel?.reasoning||[];
    return [{id:'default',label:'По умолчанию'},...options.filter(r=>r.id!=='default')];
  });
  ngOnInit(){
    this.clock=setInterval(()=>this.now.set(Date.now()),1000);
    if(typeof window!=='undefined'&&window.visualViewport){
      window.visualViewport.addEventListener('resize',this.onViewportResize);
    }
    this.restore();
  }
  ngOnDestroy(){
    this.socket?.disconnect();
    if(this.clock)clearInterval(this.clock);
    if(typeof window!=='undefined'&&window.visualViewport){
      window.visualViewport.removeEventListener('resize',this.onViewportResize);
    }
    this.cleanupScrollObserver();
    if(this.autoScrollTimeout)clearTimeout(this.autoScrollTimeout);
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
  async logout(){await this.api('/logout',{method:'POST'});this.socket?.disconnect();this.managedRunner.set(null);this.loggedIn.set(false);this.current.set(null);}
  async load(){const [accounts,runners,projects,sessions]=await Promise.all([this.api<Account[]>('/accounts'),this.api<Runner[]>('/runners'),this.api<Project[]>('/projects'),this.api<ChatSession[]>('/sessions')]);this.accounts.set(accounts);this.runners.set(runners);this.projects.set(projects);this.selectedRunner=runners.find(r=>!r.revokedAt)?.id||'';this.sessions.set(sessions);void this.refreshPreviews();if(sessions.length)await this.openSession(sessions[0].id);else {if(projects.length)this.selectedProjectId.set(projects[0].id);await this.newSession();}if(!runners.some(r=>!r.revokedAt))this.page.set('runners');}
  async refreshAccounts(){this.accounts.set(await this.api<Account[]>('/accounts'));}
  async refreshRunners(){const rows=await this.api<Runner[]>('/runners');this.runners.set(rows);const managed=this.managedRunner();if(managed)this.managedRunner.set(rows.find(row=>row.id===managed.id)||null);await this.refreshAccounts();if(!this.selectedRunner)this.selectedRunner=this.runners().find(r=>!r.revokedAt)?.id||'';}
  async newSession(){this.mobileMenu.set(false);try{const projectId=this.selectedProjectId()||undefined;const s=await this.api<ChatSession>('/sessions',{method:'POST',body:JSON.stringify(projectId?{projectId}:{})});this.sessions.update(v=>[s,...v]);this.current.set(s);this.selectedProjectId.set(s.projectId||'');this.page.set('chat');this.resetRun();this.error.set('');this.syncRun(s.id);setTimeout(()=>this.scrollToBottom(true,'auto'),50);}catch(e){this.error.set((e as Error).message);}}
  async openSession(id:string){this.mobileMenu.set(false);try{const s=await this.api<ChatSession>('/sessions/'+id);this.current.set(s);this.selectedProjectId.set(s.projectId||'');this.resetRun();this.error.set('');this.page.set('chat');this.syncRun(id);setTimeout(()=>this.scrollToBottom(true,'auto'),50);}catch(e){this.error.set((e as Error).message);}}
  chatsFor(projectId?:string){return this.sessions().filter(s=>projectId?s.projectId===projectId:!s.projectId);}
  projectRunner(project:Project){return this.runners().find(r=>r.id===project.runnerId)?.name||'Исполнитель';}
  selectProject(id:string){this.selectedProjectId.set(id);this.page.set('projects');this.mobileMenu.set(false);}
  newSessionFor(projectId:string){this.selectedProjectId.set(projectId);this.newSession();}
  async createProject(){const name=window.prompt('Название проекта');if(!name?.trim())return;const runnerId=this.selectedRunner||this.runners().find(r=>!r.revokedAt)?.id;if(!runnerId){this.error.set('Сначала подключите исполнитель');return;}try{const project=await this.api<Project>('/projects',{method:'POST',body:JSON.stringify({name:name.trim(),runnerId})});this.projects.update(v=>[project,...v]);this.selectedProjectId.set(project.id);this.notice.set(`Проект «${project.name}» создан`);await this.newSession();}catch(e){this.error.set((e as Error).message);}}
  async uploadFile(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0],projectId=this.current()?.projectId;if(input)input.value='';if(!file)return;if(!projectId){this.error.set('Сначала откройте чат внутри проекта');return;}if(file.size>20*1024*1024){this.error.set('Файл больше 20 МБ');return;}this.uploading.set(true);this.error.set('');try{const response=await fetch(`/api/projects/${projectId}/files`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file,credentials:'same-origin'});const body=await response.json() as {name?:string;size?:number;error?:string};if(!response.ok)throw new Error(body.error||'Не удалось загрузить файл');this.notice.set(`Файл «${body.name||file.name}» добавлен в папку проекта`);}catch(error){this.error.set(error instanceof Error?error.message:'Не удалось загрузить файл');}finally{this.uploading.set(false);}}
  showPage(page:'chat'|'projects'|'sites'|'connections'|'runners'){this.page.set(page);this.mobileMenu.set(false);if(page==='runners')this.refreshRunners();else this.managedRunner.set(null);if(page==='sites')void this.refreshPreviews();if(page==='chat')setTimeout(()=>this.scrollToBottom(true,'auto'),50);}
  async refreshPreviews(){try{const rows=await Promise.all(this.runners().filter(r=>!r.revokedAt).map(r=>this.api<Preview[]>('/runners/'+r.id+'/previews')));this.previews.set(rows.flat().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}catch(e){if(this.page()==='sites')this.error.set((e as Error).message);}}
  async setPreviewVisible(preview:Preview,visible:boolean){try{await this.api('/runners/'+preview.runnerId+'/previews/'+preview.subdomain,{method:'PATCH',body:JSON.stringify({visible})});await this.refreshPreviews();this.notice.set(visible?'Сайт открыт':'Сайт скрыт');}catch(e){this.error.set((e as Error).message);}}
  previewRunner(preview:Preview){return this.runners().find(r=>r.id===preview.runnerId)?.name||'Runner';}
  connect(){this.socket?.disconnect();this.socket=io({path:'/socket.io',transports:['websocket']});this.socket.on('connect',()=>{if(this.error()==='Соединение с сервером потеряно')this.error.set('');const id=this.current()?.id;if(id)this.syncRun(id);});this.socket.on('disconnect',()=>{if(this.running())this.notice.set('Соединение потеряно. Восстанавливаем статус задачи…');});this.socket.on('ai:event',(e:AIEvent)=>this.onEvent(e));this.socket.on('accounts:changed',(a:Account[])=>{this.accounts.set(a);const available=this.models();if(!available.some(m=>m.id===this.selectedModel))this.selectedModel='default';this.validateReasoning();});this.socket.on('connect_error',()=>this.error.set('Соединение с сервером потеряно'));}
  resetRun(){this.running.set(false);this.runId.set('');this.stream.set('');this.activeAccount.set('');this.activeProvider.set(undefined);this.activity.set([]);this.runStartedAt.set('');}
  syncRun(sessionId:string){if(!this.socket?.connected)return;this.socket.emit('run:state',sessionId,(state:RunState|null)=>{if(this.current()?.id!==sessionId)return;if(!state){if(this.runId())this.resetRun();return;}this.runId.set(state.runId);this.running.set(true);this.runStartedAt.set(state.startedAt);this.activeAccount.set(state.accountId||'');if(state.provider)this.activeProvider.set(state.provider);this.stream.set(state.stream||'');this.activity.set(state.activity||[]);this.notice.set(state.message||'Задача выполняется');this.error.set('');this.requestScrollToBottom();});}
  onEvent(e:AIEvent){if(e.sessionId!==this.current()?.id)return;if(e.provider)this.activeProvider.set(e.provider as ProviderId);if(e.type==='started'){this.running.set(true);this.runId.set(e.runId);this.runStartedAt.set(new Date().toISOString());this.activity.set([]);this.notice.set(e.message||'Запрос принят');this.requestScrollToBottom();}else if(e.type==='delta'){this.stream.update(s=>s+(e.text||''));this.activeAccount.set(e.data?.accountId||'');this.requestScrollToBottom();}else if(e.type==='status'||e.type==='tool'||e.type==='fallback'||e.type==='checkpoint'||e.type==='handoff_started'||e.type==='handoff_ready'){if(e.type==='handoff_started')this.stream.set('');if(e.message){this.notice.set(e.message);this.activity.update(rows=>[...rows,{type:e.type,message:e.message!,at:new Date().toISOString(),provider:e.provider as ProviderId,accountId:e.data?.accountId}].slice(-12));}this.activeAccount.set(e.data?.accountId||this.activeAccount());this.requestScrollToBottom();}else if(e.type==='error'){this.error.set(e.message||'Ошибка');this.resetRun();this.reloadCurrent();}else if(e.type==='completed'){this.resetRun();this.notice.set(e.message||'Готово');this.reloadCurrent();}}
  async reloadCurrent(){const id=this.current()?.id;if(!id)return;const s=await this.api<ChatSession>('/sessions/'+id);this.current.set(s);this.sessions.update(list=>[s,...list.filter(x=>x.id!==s.id)]);this.requestScrollToBottom();}
  send(){const prompt=this.draft.trim(),s=this.current();if(!prompt||!s||this.running())return;if(!this.socket?.connected){this.error.set('Соединение с сервером потеряно');return;}this.error.set('');this.notice.set('');this.stream.set('');this.activity.set([]);this.runStartedAt.set(new Date().toISOString());this.running.set(true);this.draft='';this.current.update(x=>x?{...x,messages:[...x.messages,{id:'pending',role:'user',text:prompt,at:new Date().toISOString()}]}:x);
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
}
