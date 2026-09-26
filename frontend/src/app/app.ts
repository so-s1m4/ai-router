import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { io, Socket } from 'socket.io-client';
import { LucideArrowUp, LucideArrowUpRight, LucideBot, LucideCopy, LucideFolder, LucideInfo, LucideLogOut, LucideMenu, LucideMessageSquare, LucidePaperclip, LucidePencilLine, LucidePlugZap, LucidePlus, LucideRefreshCw, LucideServer, LucideSparkles, LucideSquare, LucideX } from '@lucide/angular';

type ProviderId = 'codex'|'antigravity';
type Model = {id:string;label:string};
type UsageWindow = {usedPercent:number;remainingPercent:number;windowMinutes:number|null;resetAt:string|null};
type Account = {id:string;provider:ProviderId;name:string;runnerId?:string;models:Model[];mode:'runner'|'offline'|'unassigned';auth:string;detail:string;limit:{source:'provider'|'unknown';primary:UsageWindow|null;secondary:UsageWindow|null;cooldownUntil:string|null;updatedAt:string|null}};
type Runner = {id:string;name:string;online:boolean;createdAt:string;revokedAt?:string};
type Project = {id:string;name:string;runnerId:string;createdAt:string;updatedAt:string};
type Pairing = {code:string;expiresAt:string};
type Message = {id:string;role:'user'|'assistant';text:string;at:string;provider?:ProviderId};
type ChatSession = {id:string;title:string;updatedAt:string;messages:Message[];projectId?:string};
type AIEvent = {id:string;sessionId:string;runId:string;type:string;provider?:ProviderId;message?:string;text?:string;data?:{accountId?:string}};

@Component({selector:'app-root',standalone:true,imports:[CommonModule,FormsModule,LucideArrowUp,LucideArrowUpRight,LucideBot,LucideCopy,LucideFolder,LucideInfo,LucideLogOut,LucideMenu,LucideMessageSquare,LucidePaperclip,LucidePencilLine,LucidePlugZap,LucidePlus,LucideRefreshCw,LucideServer,LucideSparkles,LucideSquare,LucideX],templateUrl:'./app.html',styleUrl:'./app.css'})
export class App implements OnInit,OnDestroy {
  username=''; password=''; loginName=''; loginError=''; registerMode=signal(false);
  loggedIn=signal(false); page=signal<'chat'|'projects'|'connections'|'runners'>('chat');
  mobileMenu=signal(false);
  accounts=signal<Account[]>([]); runners=signal<Runner[]>([]); projects=signal<Project[]>([]); selectedProjectId=signal(''); pairing=signal<Pairing|null>(null); sessions=signal<ChatSession[]>([]); current=signal<ChatSession|null>(null);
  draft=''; selectedAccount='auto'; selectedModel='default'; runMode:'chat'|'task'='chat';
  accountName=''; accountProvider:ProviderId='codex'; selectedRunner=''; runnerName='Мой компьютер'; notice=signal(''); error=signal('');
  running=signal(false); uploading=signal(false); runId=signal(''); stream=signal(''); activeAccount=signal('');
  socket?:Socket;
  models=computed(()=>{const id=this.selectedAccount; if(id==='auto')return [{id:'default',label:'По умолчанию выбранного CLI'}]; return this.accounts().find(a=>a.id===id)?.models||[{id:'default',label:'По умолчанию CLI'}];});
  ngOnInit(){this.restore();} ngOnDestroy(){this.socket?.disconnect();}
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
  async logout(){await this.api('/logout',{method:'POST'});this.socket?.disconnect();this.loggedIn.set(false);this.current.set(null);}
  async load(){const [accounts,runners,projects,sessions]=await Promise.all([this.api<Account[]>('/accounts'),this.api<Runner[]>('/runners'),this.api<Project[]>('/projects'),this.api<ChatSession[]>('/sessions')]);this.accounts.set(accounts);this.runners.set(runners);this.projects.set(projects);this.selectedRunner=runners.find(r=>!r.revokedAt)?.id||'';this.sessions.set(sessions);if(sessions.length)await this.openSession(sessions[0].id);else {if(projects.length)this.selectedProjectId.set(projects[0].id);await this.newSession();}if(!runners.some(r=>!r.revokedAt))this.page.set('runners');}
  async refreshAccounts(){this.accounts.set(await this.api<Account[]>('/accounts'));}
  async refreshRunners(){this.runners.set(await this.api<Runner[]>('/runners'));await this.refreshAccounts();if(!this.selectedRunner)this.selectedRunner=this.runners().find(r=>!r.revokedAt)?.id||'';}
  async newSession(){this.mobileMenu.set(false);try{const projectId=this.selectedProjectId()||undefined;const s=await this.api<ChatSession>('/sessions',{method:'POST',body:JSON.stringify(projectId?{projectId}:{})});this.sessions.update(v=>[s,...v]);this.current.set(s);this.selectedProjectId.set(s.projectId||'');this.page.set('chat');this.stream.set('');this.error.set('');}catch(e){this.error.set((e as Error).message);}}
  async openSession(id:string){if(this.running())return;this.mobileMenu.set(false);try{const s=await this.api<ChatSession>('/sessions/'+id);this.current.set(s);this.selectedProjectId.set(s.projectId||'');this.stream.set('');this.error.set('');this.page.set('chat');}catch(e){this.error.set((e as Error).message);}}
  chatsFor(projectId?:string){return this.sessions().filter(s=>projectId?s.projectId===projectId:!s.projectId);}
  projectRunner(project:Project){return this.runners().find(r=>r.id===project.runnerId)?.name||'Исполнитель';}
  selectProject(id:string){this.selectedProjectId.set(id);this.page.set('projects');this.mobileMenu.set(false);}
  newSessionFor(projectId:string){this.selectedProjectId.set(projectId);this.newSession();}
  async createProject(){const name=window.prompt('Название проекта');if(!name?.trim())return;const runnerId=this.selectedRunner||this.runners().find(r=>!r.revokedAt)?.id;if(!runnerId){this.error.set('Сначала подключите исполнитель');return;}try{const project=await this.api<Project>('/projects',{method:'POST',body:JSON.stringify({name:name.trim(),runnerId})});this.projects.update(v=>[project,...v]);this.selectedProjectId.set(project.id);this.notice.set(`Проект «${project.name}» создан`);await this.newSession();}catch(e){this.error.set((e as Error).message);}}
  async uploadFile(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0],projectId=this.current()?.projectId;if(input)input.value='';if(!file)return;if(!projectId){this.error.set('Сначала откройте чат внутри проекта');return;}if(file.size>20*1024*1024){this.error.set('Файл больше 20 МБ');return;}this.uploading.set(true);this.error.set('');try{const response=await fetch(`/api/projects/${projectId}/files`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file,credentials:'same-origin'});const body=await response.json() as {name?:string;size?:number;error?:string};if(!response.ok)throw new Error(body.error||'Не удалось загрузить файл');this.notice.set(`Файл «${body.name||file.name}» добавлен в папку проекта`);}catch(error){this.error.set(error instanceof Error?error.message:'Не удалось загрузить файл');}finally{this.uploading.set(false);}}
  showPage(page:'chat'|'projects'|'connections'|'runners'){this.page.set(page);this.mobileMenu.set(false);if(page==='runners')this.refreshRunners();}
  connect(){this.socket?.disconnect();this.socket=io({path:'/socket.io',transports:['websocket']});this.socket.on('ai:event',(e:AIEvent)=>this.onEvent(e));this.socket.on('accounts:changed',(a:Account[])=>{this.accounts.set(a);const selected=this.accounts().find(x=>x.id===this.selectedAccount);if(selected&&this.selectedModel!=='default'&&!selected.models.some(m=>m.id===this.selectedModel))this.selectedModel='default';});this.socket.on('connect_error',()=>this.error.set('Соединение с сервером потеряно'));}
  onEvent(e:AIEvent){if(e.sessionId!==this.current()?.id)return;if(e.type==='delta'){this.stream.update(s=>s+(e.text||''));this.activeAccount.set(e.data?.accountId||'');}else if(e.type==='status'||e.type==='fallback'){this.notice.set(e.message||'');this.activeAccount.set(e.data?.accountId||'');}else if(e.type==='error'){this.error.set(e.message||'Ошибка');this.running.set(false);this.runId.set('');this.stream.set('');this.reloadCurrent();}else if(e.type==='completed'){this.running.set(false);this.runId.set('');this.stream.set('');this.notice.set(e.message||'Готово');this.reloadCurrent();}}
  async reloadCurrent(){const id=this.current()?.id;if(!id)return;const s=await this.api<ChatSession>('/sessions/'+id);this.current.set(s);this.sessions.update(list=>[s,...list.filter(x=>x.id!==s.id)]);}
  send(){const prompt=this.draft.trim(),s=this.current();if(!prompt||!s||this.running())return;this.error.set('');this.notice.set('');this.stream.set('');this.running.set(true);this.draft='';this.current.update(x=>x?{...x,messages:[...x.messages,{id:'pending',role:'user',text:prompt,at:new Date().toISOString()}]}:x);
    this.socket?.emit('run',{sessionId:s.id,prompt,accountId:this.selectedAccount,model:this.selectedModel,mode:this.runMode},(ack:{ok:boolean;runId?:string;error?:string})=>{if(ack.ok)this.runId.set(ack.runId||'');else{this.running.set(false);this.error.set(ack.error||'Ошибка');this.draft=prompt;this.reloadCurrent();}});
  }
  cancel(){if(this.runId())this.socket?.emit('cancel',this.runId());}
  async addAccount(){this.error.set('');try{await this.api('/accounts',{method:'POST',body:JSON.stringify({provider:this.accountProvider,name:this.accountName,runnerId:this.selectedRunner})});this.accountName='';await this.refreshAccounts();this.notice.set('Аккаунт добавлен. Выполните команду входа на своём контейнере.');}catch(e){this.error.set((e as Error).message);}}
  async assignAccount(a:Account,runnerId:string){try{await this.api('/accounts/'+a.id,{method:'PATCH',body:JSON.stringify({runnerId})});await this.refreshAccounts();}catch(e){this.error.set((e as Error).message);}}
  async createPairing(){this.error.set('');try{this.pairing.set(await this.api<Pairing>('/runners/pairing',{method:'POST',body:JSON.stringify({name:this.runnerName})}));}catch(e){this.error.set((e as Error).message);}}
  async revokeRunner(r:Runner){if(!confirm(`Отключить ${r.name}? Его задачи остановятся.`))return;try{await this.api('/runners/'+r.id,{method:'DELETE'});await this.refreshRunners();}catch(e){this.error.set((e as Error).message);}}
  loginCommand(a:Account){return `docker compose -f runner/compose.yaml exec runner /app/scripts/provider-login.sh ${a.provider} ${a.id}`;}
  async copy(text:string){await navigator.clipboard.writeText(text);this.notice.set('Команда скопирована');}
  accountLabel(id:string){return this.accounts().find(a=>a.id===id)?.name||'';}
  providerLabel(id?:ProviderId){return id==='codex'?'Codex':id==='antigravity'?'Antigravity':'';}
  limitLabel(a:Account){if(a.limit.cooldownUntil)return 'Ограничен';if(a.limit.primary||a.limit.secondary)return 'Квота аккаунта';return 'Провайдер';}
  windowLabel(window:UsageWindow){const minutes=window.windowMinutes;if(minutes===300)return '5 ч';if(minutes===10080)return 'Неделя';if(minutes===43200)return 'Месяц';if(minutes&&minutes%60===0)return `${minutes/60} ч`;return 'Окно';}
  remaining(window:UsageWindow|null){return window?`${Math.round(window.remainingPercent)}%`:'';}
  accountMode(a:Account){return a.mode==='runner'?'Контейнер в сети':a.mode==='offline'?'Не в сети':'Без контейнера';}
  selectAccount(id:string){this.selectedAccount=id;this.selectedModel='default';}
}
