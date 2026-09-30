import { Component, OnInit, AfterViewInit, OnDestroy, signal, computed, ViewChild, ElementRef, HostListener } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { io, Socket } from 'socket.io-client';
import {
  LucideArrowUp, LucideArrowUpRight, LucideBell, LucideBookOpen, LucideBot, LucideCheck,
  LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideCircleQuestionMark,
  LucideCopy, LucideDownload,  LucideFile, LucideFolder, LucideFolderOpen, LucideGlobe2,
  LucideGraduationCap, LucideInfo, LucideLogOut, LucideMenu, LucideMessageSquare,
  LucideOrigami, LucidePanelLeft,
  LucidePlugZap, LucidePlus, LucideRefreshCw, LucideRotateCcw,
  LucideSearch, LucideServer, LucideSettings2, LucideSparkles, LucideSquare, LucideSquarePen, LucideTerminal, LucideTrash2, LucideUploadCloud, LucideX, LucideZap
} from '@lucide/angular';
import { ManagerPanel } from './manager-panel';
import { MarkdownPipe } from './markdown.pipe';

type ProviderId = 'codex' | 'antigravity' | 'chatgpt';
export type ServiceId = 'auto' | 'gemini' | 'codex' | 'chatgpt';
type ReasoningEffort = {id:string;label:string};
type Model = {id:string;label:string;reasoning?:ReasoningEffort[];defaultReasoning?:string};

export const DEFAULT_CODEX_MODELS: Model[] = [
  { id: 'default', label: 'Codex default' }
];

export const DEFAULT_GEMINI_MODELS: Model[] = [
  { id: 'default', label: 'Gemini default' }
];

export const DEFAULT_CHATGPT_MODELS: Model[] = [
  { id: 'default', label: 'ChatGPT default' }
];
type UsageWindow = {usedPercent:number;remainingPercent:number;windowMinutes:number|null;resetAt:string|null};
type ResetCredits = {availableCount:number;credits:{id:string;expiresAt:string|null;title:string|null}[]|null};
type Account = {shared?:boolean;id:string;provider:ProviderId;name:string;runnerId?:string;priority?:0|1|2;authType?:'api_key';models:Model[];mode:'runner'|'offline'|'unassigned';auth:string;detail:string;limit:{resetCredits?:ResetCredits|null;source:'provider'|'unknown';primary:UsageWindow|null;secondary:UsageWindow|null;cooldownUntil:string|null;updatedAt:string|null}};
type QueueTask = {id:string;input:{sessionId:string;prompt:string;model:string;service?:string};createdAt:string;updatedAt:string;priority:number;state:string;message:string;startedAt?:string;lastActivityAt?:string;activity?:RunActivity[];resumedBy?:string;recovery?:{checkpoint:boolean;updatedAt:string;partialText:string;activity:RunActivity[]}};
type UsageSummary={totalTokens:number;source:string;byProject:{id:string;tokens:number}[];byModel:{id:string;tokens:number}[];byProvider:{id:string;tokens:number}[];accounts:Account[];grants:(AccessGrant & {remainingTokens:number})[];projects:{id:string;name:string}[]};
type AccessGrant = {id:string;direction:'outgoing'|'incoming';ownerName:string;recipientName:string;models:string[];budget:number;period:'once'|'monthly';state:'pending'|'active'|'revoked';usedTokens:number;lifetimeTokens:number;usageByModel:Record<string,number>};
type Runner = {id:string;name:string;online:boolean;managementOnline:boolean;createdAt:string;revokedAt?:string};
type Project = {id:string;name:string;runnerId:string;createdAt:string;updatedAt:string;shared?:boolean;ownerId?:string;memberIds?:string[]};
type Preview = {subdomain:string;runnerId:string;visible:boolean;online:boolean;expired:boolean;url:string;createdAt:string;updatedAt:string;expiresAt:string};
type Pairing = {code:string;expiresAt:string};
type TokenUsage = {totalTokens:number;inputTokens?:number;outputTokens?:number;cachedInputTokens?:number;reasoningOutputTokens?:number};
type Message = {id:string;role:'user'|'assistant'|'system';text:string;at?:string;provider?:ProviderId|string;tokenUsage?:TokenUsage;steps?:any[];[key:string]:any};
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
type FileGroup = {kind:'projects'|'sessions';id:string;title:string;runnerId:string;files:{name:string;size:number;modified:string}[];error?:string};
type AIEvent = {at?:string;id:string;sessionId:string;runId:string;type:string;provider?:ProviderId;message?:string;text?:string;data?:{accountId?:string;state?:string;steeringAvailable?:boolean;steeringMessage?:Message}};
type RunActivity = {type:string;message:string;at:string;provider?:ProviderId;accountId?:string};
type RunState = {lastActivityAt?:string;runId:string;sessionId:string;startedAt:string;accountId?:string;provider?:ProviderId;message:string;stream:string;activity:RunActivity[];steeringAvailable?:boolean} | {runId:string;sessionId:string;type:'completed'|'error';message:string;finishedAt:number};

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
    CommonModule, FormsModule, LucideBell, LucideArrowUp, LucideArrowUpRight, LucideBookOpen, LucideBot, LucideCheck,
    LucideChevronDown, LucideChevronRight, LucideCircleQuestionMark, LucideCopy, LucideDownload,
    LucideFile, LucideFolder, LucideFolderOpen, LucideGlobe2, LucideGraduationCap, LucideInfo, LucideLogOut, LucideMenu,
    LucideMessageSquare, LucideOrigami, LucidePanelLeft, LucidePlugZap, LucidePlus,
    LucideRefreshCw, LucideRotateCcw, LucideSearch, LucideServer, LucideSettings2, LucideSparkles, LucideSquare, LucideSquarePen, LucideTerminal, LucideTrash2, LucideUploadCloud, LucideX,
    LucideZap, ManagerPanel, MarkdownPipe
  ],
  templateUrl:'./app.html',
  styleUrls:['./app.css', './adaptive.css', './features.css']
})
export class App implements OnInit,AfterViewInit,OnDestroy {
  constructor(private sanitizer:DomSanitizer){}
  steeringAvailable=signal(false); steeringSending=signal(false);
  fileGroups=signal<FileGroup[]>([]); libraryLoading=signal(false); libraryQuery=signal(''); librarySource=signal('');
  selectedLibraryFiles=signal<Set<string>>(new Set());
  librarySelectionKey(group:Pick<FileGroup,'kind'|'id'>,name:string){return JSON.stringify([group.kind,group.id,name]);}
  libraryGroups=computed(()=>this.fileGroups().filter(g=>!this.librarySource()||g.kind+':'+g.id===this.librarySource()).map(g=>({...g,files:g.files.filter(f=>f.name.toLowerCase().includes(this.libraryQuery().trim().toLowerCase()))})).filter(g=>g.files.length||g.error));
  previewOpen=signal(false); previewLoading=signal(false); previewName=signal(''); previewError=signal(''); previewText=signal(''); previewKind=signal(''); previewUrl=signal(''); previewPdf=signal<SafeResourceUrl|null>(null);
  private previewRequest=0;
  private previewReturnFocus?:HTMLElement;
  @HostListener('document:keydown', ['$event'])
  onPreviewKey(event:KeyboardEvent){
    if(!this.previewOpen())return;
    if(event.key==='Escape'){event.preventDefault();this.closePreview();return;}
    if(event.key==='Tab'){
      const dialog=document.querySelector<HTMLElement>('.file-preview-dialog');
      const items=dialog?.querySelectorAll<HTMLElement>('button, iframe, [tabindex="0"]');
      if(!items?.length)return;
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  }
  telegram=signal<{configured:boolean;connected:boolean;name:string;enabled:boolean;lastError:string}|null>(null);
  telegramLink=signal(''); telegramBusy=signal(false);
  browserNotifications=signal(false);
  async refreshLibrary(){if(this.libraryLoading())return;this.libraryLoading.set(true);this.error.set('');try{this.fileGroups.set((await this.api<{groups:FileGroup[]}>('/files')).groups);const keys=new Set(this.fileGroups().flatMap(g=>g.files.map(f=>this.librarySelectionKey(g,f.name))));this.selectedLibraryFiles.update(selected=>new Set([...selected].filter(key=>keys.has(key))));}catch(e){this.error.set((e as Error).message);}finally{this.libraryLoading.set(false);}}
  async previewFile(name:string,kind:'projects'|'sessions'='sessions',id=this.current()?.id){
    if(!id)return;this.closePreview();this.previewReturnFocus=document.activeElement as HTMLElement;const request=++this.previewRequest;this.previewOpen.set(true);this.previewLoading.set(true);this.previewName.set(name);requestAnimationFrame(()=>document.querySelector<HTMLElement>('.file-preview-dialog')?.focus());
    try{
      const response=await fetch('/api/workspaces/'+kind+'/'+id+'/preview?name='+encodeURIComponent(name),{credentials:'same-origin'});
      if(!response.ok){const data=await response.json();throw new Error(data.error||'File not available');}
      const mime=response.headers.get('Content-Type')||'';
      const blob=await response.blob();if(request!==this.previewRequest)return;
      if(mime.startsWith('text/')){this.previewKind.set('text');this.previewText.set(await blob.text());}
      else if(mime.startsWith('image/')||mime==='application/pdf'){
        const url=URL.createObjectURL(blob);this.previewUrl.set(url);this.previewKind.set(mime==='application/pdf'?'pdf':'image');
        if(mime==='application/pdf')this.previewPdf.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      }else throw new Error('Format does not support viewing');
    }catch(e){if(request===this.previewRequest)this.previewError.set((e as Error).message);}finally{if(request===this.previewRequest)this.previewLoading.set(false);}
  }
  closePreview(){this.previewRequest++;if(this.previewUrl())URL.revokeObjectURL(this.previewUrl());this.previewOpen.set(false);this.previewUrl.set('');this.previewPdf.set(null);this.previewText.set('');this.previewError.set('');this.previewKind.set('');this.previewReturnFocus?.focus();this.previewReturnFocus=undefined;}
  async libraryShare(group:FileGroup,name:string,download=false){try{const result=await this.api<{url:string}>('/workspaces/'+group.kind+'/'+group.id+'/share',{method:'POST',body:JSON.stringify({name})});const url=new URL(result.url,location.origin).href;if(download){const a=document.createElement('a');a.href=url;a.download=name.split('/').pop()||name;a.click();}else{await this.copy(url,'library-share');this.notice.set('Link copied. Valid for 7 days.');}}catch(e){this.error.set((e as Error).message);}}
  libraryVisibleKeys=computed(()=>this.libraryGroups().flatMap(g=>g.files.map(f=>this.librarySelectionKey(g,f.name))));
  allLibraryFilesSelected=computed(()=>this.libraryVisibleKeys().length>0&&this.libraryVisibleKeys().every(key=>this.selectedLibraryFiles().has(key)));
  someLibraryFilesSelected=computed(()=>this.libraryVisibleKeys().some(key=>this.selectedLibraryFiles().has(key)));
  emptyFileSelection(){return new Set<string>();}
  toggleFileSelection(scope:'library'|'task',key:string,checked:boolean){
    if(this.deletingFile())return;
    const selection=scope==='library'?this.selectedLibraryFiles:this.selectedTaskFiles;
    selection.update(current=>{const next=new Set(current);if(checked)next.add(key);else next.delete(key);return next;});
  }
  selectAllFiles(scope:'library'|'task',checked:boolean){
    if(this.deletingFile())return;
    const keys=scope==='library'?this.libraryVisibleKeys():this.filteredTaskFileNames();
    const selection=scope==='library'?this.selectedLibraryFiles:this.selectedTaskFiles;
    selection.update(current=>{const next=new Set(current);for(const key of keys){if(checked)next.add(key);else next.delete(key);}return next;});
  }
  async libraryDelete(group:FileGroup,name:string){await this.deleteFiles([{kind:group.kind,id:group.id,name}]);}
  async deleteSelectedLibraryFiles(){
    const selected=this.selectedLibraryFiles();
    const targets=this.fileGroups().flatMap(g=>g.files.filter(f=>selected.has(this.librarySelectionKey(g,f.name))).map(f=>({kind:g.kind,id:g.id,name:f.name})));
    await this.deleteFiles(targets);
  }
  private async deleteFiles(targets:{kind:'projects'|'sessions';id:string;name:string}[]){
    if(!targets.length||this.deletingFile())return;
    const message=targets.length===1?'Delete file “'+targets[0].name+'”?':'Delete selected files ('+targets.length+')?';
    if(!confirm(message+' Files and links to them will become unavailable.'))return;
    this.deletingFile.set('bulk');this.error.set('');this.notice.set('');
    let deleted=0;const failures:string[]=[];
    try{
      for(const target of targets){
        try{
          await this.api('/workspaces/'+target.kind+'/'+encodeURIComponent(target.id)+'/files',{method:'DELETE',body:JSON.stringify({name:target.name})});
          deleted++;
          const session=this.current();
          const projectId=target.kind==='projects'?target.id:this.sessions().find(s=>s.id===target.id)?.projectId||(session?.id===target.id?session.projectId:undefined);
          const matches=(kind:string,id:string):boolean=>projectId?kind==='projects'?id===projectId:this.sessions().some(s=>s.id===id&&s.projectId===projectId)||(session?.id===id&&session?.projectId===projectId):kind===target.kind&&id===target.id;
          this.fileGroups.update(groups=>groups.map(g=>matches(g.kind,g.id)?{...g,files:g.files.filter(f=>f.name!==target.name)}:g));
          this.selectedLibraryFiles.update(selected=>new Set([...selected].filter(key=>{const [kind,id,name]=JSON.parse(key);return name!==target.name||!matches(kind,id);})));
          if(session&&matches('sessions',session.id)){
            this.taskFiles.update(files=>files.filter(f=>f.name!==target.name));
            this.selectedTaskFiles.update(selected=>{const next=new Set(selected);next.delete(target.name);return next;});
            this.sharedFileLinks.update(links=>{const next={...links};delete next[target.name];return next;});
          }
        }catch(e){failures.push(target.name+': '+(e as Error).message);}
      }
      this.notice.set('Files deleted: '+deleted+' of '+targets.length);
      if(failures.length)this.error.set('Failed to remove: '+failures.join('; '));
    }finally{this.deletingFile.set('');}
  }
  openFileSource(group:FileGroup){if(group.kind==='projects'){this.selectedProjectId.set(group.id);this.selectProject(group.id);}else void this.openSession(group.id);}
  async refreshTelegram(){try{this.telegram.set(await this.api('/notifications/telegram'));}catch(e){this.error.set((e as Error).message);}}
  async connectTelegram(){this.telegramBusy.set(true);this.error.set('');try{this.telegramLink.set((await this.api<{url:string}>('/notifications/telegram/connect',{method:'POST',body:'{}'})).url);}catch(e){this.error.set((e as Error).message);}finally{this.telegramBusy.set(false);}}
  async disconnectTelegram(){this.telegramBusy.set(true);try{await this.api('/notifications/telegram',{method:'DELETE'});this.telegramLink.set('');await this.refreshTelegram();}catch(e){this.error.set((e as Error).message);}finally{this.telegramBusy.set(false);}}
  async toggleTelegram(){this.telegramBusy.set(true);try{await this.api('/notifications/telegram',{method:'PATCH',body:JSON.stringify({enabled:!this.telegram()?.enabled})});await this.refreshTelegram();}catch(e){this.error.set((e as Error).message);}finally{this.telegramBusy.set(false);}}
  async enableBrowserNotifications(){if(!('Notification' in window)){this.error.set('Browser doesn’t support notifications');return;}if(this.browserNotifications()){this.browserNotifications.set(false);return;}const permission=await Notification.requestPermission();this.browserNotifications.set(permission==='granted');if(permission!=='granted')this.error.set('Allow notifications in your browser settings');}
  async steer(){
    const prompt=this.draft.trim(),sessionId=this.current()?.id,runId=this.runId();
    if(!prompt||!sessionId||!runId||!this.steeringAvailable()||this.steeringSending()||!this.socket?.connected)return;
    this.steeringSending.set(true);this.error.set('');
    try{const reply=await this.socket.timeout(40000).emitWithAck('steer',{runId,prompt});if(!reply?.ok)throw new Error(reply?.error||'Failed to send clarification');if(this.current()?.id===sessionId&&this.draft.trim()===prompt){this.draft='';this.adjustTextareaHeight();}this.notice.set('The refinement is passed to the model');}
    catch(e){this.error.set((e as Error).message);}finally{this.steeringSending.set(false);}
  }

  username=''; password=''; loginName=''; loginError=''; registerMode=signal(false);
  loggedIn=signal(false); page=signal<'chat'|'projects'|'sites'|'providers'|'connections'|'runners'|'users'|'files'|'notifications'|'operations'>('projects');
  isOwner=signal(false);
  users=signal<{id:string;username:string;createdAt:string}[]>([]);
  newUsername=''; newUserPassword=''; userAdminError=''; userAdminNotice='';
  mobileMenu=signal(false);
  projectCreateOpen=signal(false); projectSaving=signal(false); projectCreateError=signal(''); newProjectName=''; newProjectRunner=''; newProjectShared=false; newProjectMembers='';
  membersProject=signal<Project|null>(null); membersCanManage=signal(false); membersLoading=signal(false); membersSaving=signal(false); membersError=signal(''); projectMembers=signal<{id:string;username:string;owner:boolean}[]>([]); editProjectMembers='';
  managedRunner=signal<Runner|null>(null);
  modelBlacklist=signal<string[]>([]);
  accounts=signal<Account[]>([]); runners=signal<Runner[]>([]); projects=signal<Project[]>([]); previews=signal<Preview[]>([]); selectedProjectId=signal(''); pairing=signal<Pairing|null>(null); sessions=signal<ChatSession[]>([]); current=signal<ChatSession|null>(null);
  sidebarOpen = signal(true);
  expandedProjects = signal<Set<string>>(new Set(['CCC-Solutions', 'Quest Control', 'proj-ccc', 'proj-quest']));
  userMenuOpen = signal(false);
  helpModalOpen = signal(false);
  modelMenuOpen = signal(false);
  modelSearch = signal('');
  filteredPickerModels = computed(() => {
    const query = this.modelSearch().trim().toLocaleLowerCase();
    return this.models().filter(m => !query || (m.label + ' ' + m.id).toLocaleLowerCase().includes(query));
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
      (selected || dialog?.querySelector<HTMLElement>('button'))?.focus({preventScroll: true});
      selected?.scrollIntoView({block: 'nearest'});
    });
  }
  closeModelPicker() {
    this.modelMenuOpen.set(false);
    this.modelPickerReturnFocus?.focus({preventScroll: true});
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
    if (!this.models().some(m => m.id === id)) return;
    this.selectModel(id);
    this.closeModelPicker();
  }
  searchOpen = signal(false);
  sidebarSearch = signal('');
  currentServiceLabel = computed(() => {
    const s = this.selectedService();
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
      if (s === 'chatgpt') return 'ChatGPT';
      if (s === 'gemini') return 'Gemini';
      if (s === 'codex') return 'Codex';
      return 'Model';
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
      return 'Reasoning effort';
    }
    const opt = this.reasoningOptions().find(o => o.id === r);
    if (opt && opt.id !== 'default') return opt.label;
    if (r === 'high') return 'High';
    if (r === 'medium') return 'Medium';
    if (r === 'low') return 'Low';
    if (r === 'max') return 'Max';
    return r.charAt(0).toUpperCase() + r.slice(1);
  });
  currentReasoningOrModelLabel = computed(() => this.currentReasoningBadgeLabel());
  draft=''; selectedService=signal<ServiceId>('auto'); selectedAccount='auto'; selectedModel=signal<string>('auto'); selectedReasoning=signal<string>('default'); codexFast=signal(false);
  grants=signal<AccessGrant[]>([]); grantBusy=signal(false); grantEditor=signal(false);
  grantId=''; grantUsername=''; grantBudget=1000000; grantPeriod:'once'|'monthly'='monthly'; grantModels:string[]=[];
  ownAccounts=computed(()=>this.accounts().filter(a=>!a.shared));
  grantAvailableModels(){return [...new Map(this.ownAccounts().flatMap(a=>a.models).map(m=>[m.id,m])).values()];}
  toggleGrantModel(id:string){this.grantModels=this.grantModels.includes(id)?this.grantModels.filter(m=>m!==id):[...this.grantModels,id];}
  openGrantEditor(g?:AccessGrant){this.grantId=g?.id||'';this.grantUsername=g?.recipientName||'';this.grantBudget=g?.budget||1000000;this.grantPeriod=g?.period||'monthly';this.grantModels=g?[...g.models]:this.grantAvailableModels().filter(m=>m.id!=='default').map(m=>m.id);this.grantEditor.set(true);}
  async refreshGrants(){try{this.grants.set(await this.api<AccessGrant[]>('/access-grants'));}catch(e){this.error.set((e as Error).message);}}
  async saveGrant(){if(this.grantBusy())return;this.grantBusy.set(true);this.error.set('');try{const body=this.grantId?{budget:this.grantBudget,models:this.grantModels}:{username:this.grantUsername,budget:this.grantBudget,models:this.grantModels,period:this.grantPeriod};await this.api('/access-grants'+(this.grantId?'/'+this.grantId:''),{method:this.grantId?'PATCH':'POST',body:JSON.stringify(body)});this.grantEditor.set(false);await this.refreshGrants();await this.refreshAccounts();this.notice.set(this.grantId?'Access settings saved':'The invitation has been sent. A friend can accept it in connections.');}catch(e){this.error.set((e as Error).message);}finally{this.grantBusy.set(false);}}
  async setGrantState(g:AccessGrant,state:'active'|'revoked'){if(this.grantBusy())return;this.grantBusy.set(true);try{await this.api('/access-grants/'+g.id,{method:'PATCH',body:JSON.stringify({state})});await this.refreshGrants();await this.refreshAccounts();this.notice.set(state==='active'?'Access accepted - models available in chat':'Access revoked, current task stopped');}catch(e){this.error.set((e as Error).message);}finally{this.grantBusy.set(false);}}
  grantUsage(g:AccessGrant){return Object.entries(g.usageByModel).map(([model,tokens])=>({model,tokens}));}
  accountName=''; accountProvider:ProviderId|'openai-api'='codex'; apiKeyDrafts:Record<string,string>={}; savingApiKey=signal(''); deletingAccount=signal(''); addingAccount=signal(false); selectedRunner=''; runnerName='My computer'; notice=signal(''); error=signal('');
  running=signal(false); uploading=signal(false); runId=signal(''); stream=signal(''); activeAccount=signal(''); activeProvider=signal<ProviderId|undefined>(undefined); activity=signal<RunActivity[]>([]); runStartedAt=signal(''); now=signal(Date.now());
  tasks=signal<QueueTask[]>([]); usageSummary=signal<UsageSummary|null>(null); taskSubmitting=signal(false); lastActivityAt=signal('');
  waitingTasks=computed(()=>this.tasks().filter(t=>t.state==='queued'));
  currentWaitingTasks=computed(()=>this.waitingTasks().filter(t=>t.input.sessionId===this.current()?.id));
  currentInterruptedTasks=computed(()=>this.tasks().filter(t=>t.input.sessionId===this.current()?.id&&this.canResumeTask(t)));
  resumingTask=signal('');
  canResumeTask(task:QueueTask){return (task.state==='error'||task.state==='canceled')&&task.recovery?.checkpoint===true&&!task.resumedBy;}
  async resumeTask(task:QueueTask){
    if(this.resumingTask())return;this.resumingTask.set(task.id);this.error.set('');
    try{await this.api('/tasks/'+task.id+'/resume',{method:'POST'});await this.refreshTasks();this.notice.set('Continuation requested');}
    catch(e){this.error.set((e as Error).message);}finally{this.resumingTask.set('');}
  }
  async refreshTasks(){try{this.tasks.set(await this.api<QueueTask[]>('/tasks'));}catch(e){this.error.set((e as Error).message);}}
  async refreshUsageSummary(){try{this.usageSummary.set(await this.api<UsageSummary>('/usage-summary'));}catch(e){this.error.set((e as Error).message);}}
  async changeTaskPriority(task:QueueTask,priority:string){try{await this.api('/tasks/'+task.id,{method:'PATCH',body:JSON.stringify({priority:Number(priority)})});await this.refreshTasks();}catch(e){this.error.set((e as Error).message);}}
  async cancelTask(task:QueueTask){try{await this.api('/tasks/'+task.id,{method:'DELETE'});await this.refreshTasks();}catch(e){this.error.set((e as Error).message);}}
  durationSince(at?:string){if(!at)return '—';const seconds=Math.max(0,Math.floor((this.now()-Date.parse(at))/1000));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
  projectUsageName(id:string){return id==='no-project'?'Without project':this.usageSummary()?.projects.find(p=>p.id===id)?.name||id;}
  accountAvailable(a:Account){return a.mode==='runner'&&!a.limit.cooldownUntil&&![a.limit.primary,a.limit.secondary].some(w=>w&&w.usedPercent>=100&&(!w.resetAt||Date.parse(w.resetAt)>this.now()));}
  socket?:Socket;
  private clock?:ReturnType<typeof setInterval>;
  copiedId=signal<string>('');
  selectedTaskFiles=signal<Set<string>>(new Set());
  filteredTaskFileNames=computed(()=>this.taskFiles().filter(f=>f.name.toLowerCase().includes(this.filesFilter().trim().toLowerCase())).map(f=>f.name));
  allTaskFilesSelected=computed(()=>this.filteredTaskFileNames().length>0&&this.filteredTaskFileNames().every(name=>this.selectedTaskFiles().has(name)));
  someTaskFilesSelected=computed(()=>this.filteredTaskFileNames().some(name=>this.selectedTaskFiles().has(name)));
  taskFiles=signal<{name:string;size:number;modified:string}[]>([]);
  sharedFileLinks=signal<Record<string,string>>({});
  deletingFile=signal('');
  filesOpen=signal(false); filesLoading=signal(false);
  collapsedDirs=signal<Set<string>>(new Set());
  filesFilter=signal<string>('');
  isDraggingOver = signal(false);
  private dragCounter = 0;

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
  private viewportRaf?: number;
  private onViewportResize = () => {
    if (this.viewportRaf !== undefined) return;
    this.viewportRaf = requestAnimationFrame(() => {
      this.viewportRaf = undefined;
      const viewport = window.visualViewport;
      // Pinch zoom keeps the layout intact; keyboard/browser chrome resize it.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const height = viewport?.height ?? window.innerHeight;
      const root = document.documentElement;
      root.style.setProperty('--app-height', height + 'px');
      root.style.setProperty('--app-top', (viewport?.offsetTop ?? 0) + 'px');
      const active = document.activeElement;
      const editing = active instanceof HTMLElement &&
        active.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]');
      root.classList.toggle('keyboard-open', editing && window.innerHeight - height > 150);
      if (this.current()?.messages.length && !this.userScrolledUp() && active?.matches('.pill-textarea')) {
        this.requestScrollToBottom();
      }
      if (editing) {
        const bounds = active.getBoundingClientRect();
        const top = viewport?.offsetTop ?? 0;
        if (bounds.top < top || bounds.bottom > top + height) {
          active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        }
      }
    });
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

  onChatWheel(event:WheelEvent){if(event.deltaY<0){this.userScrolledUp.set(true);this.showScrollBottom.set(true);}}
  onChatTouch(){this.userScrolledUp.set(true);this.showScrollBottom.set(true);}
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

  currentProject=computed(()=>{const pId=this.current()?.projectId || this.selectedProjectId();return pId?this.projects().find(p=>p.id===pId):null;});
  models=computed(()=>{
    const autoModel:Model={id:'auto',label:'Auto · by task complexity'};
    const blacklist=new Set(this.modelBlacklist());
    const allAccounts=Array.isArray(this.accounts()) ? this.accounts() : [];
    const pId=this.current()?.projectId || this.selectedProjectId();
    const project=pId?this.projects().find(p=>p.id===pId):null;
    const scoped=project&&!project.shared?allAccounts.filter(a=>a.runnerId===project.runnerId):allAccounts;

    const service=this.selectedService();

    if(service==='gemini'){
      const accModels=scoped.filter(a=>a.provider==='antigravity').flatMap(a=>a.models||[]);
      const map=new Map<string,Model>();
      for(const m of DEFAULT_GEMINI_MODELS)map.set(m.id,{...m});
      for(const m of accModels)if(m.id!=='default')map.set(m.id,m);
      map.set('default',{id:'default',label:'Gemini default'});
      return [autoModel,...map.values()].filter(m=>m.id==='auto'||m.id==='default'||!blacklist.has(m.id));
    }

    if(service==='codex'){
      const accModels=scoped.filter(a=>a.provider==='codex').flatMap(a=>a.models||[]);
      const map=new Map<string,Model>();
      for(const m of DEFAULT_CODEX_MODELS)map.set(m.id,{...m});
      for(const m of accModels)if(m.id!=='default')map.set(m.id,m);
      map.set('default',{id:'default',label:'Codex default'});
      return [autoModel,...map.values()].filter(m=>m.id==='auto'||m.id==='default'||!blacklist.has(m.id));
    }

    if(service==='chatgpt'){
      const accModels=scoped.filter(a=>a.provider==='chatgpt').flatMap(a=>a.models||[]);
      const map=new Map<string,Model>();
      for(const m of DEFAULT_CHATGPT_MODELS)map.set(m.id,{...m});
      for(const m of accModels)if(m.id!=='default')map.set(m.id,m);
      map.set('default',{id:'default',label:'ChatGPT default'});
      return [autoModel,...map.values()].filter(m=>m.id==='auto'||m.id==='default'||!blacklist.has(m.id));
    }

    const map=new Map<string,Model>();
    map.set('default',{id:'default',label:'Default (Auto)'});
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
    return [autoModel,...map.values()].filter(m=>m.id==='auto'||m.id==='default'||!blacklist.has(m.id));
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
      this.notice.set(refresh.requested?'Model update launched':'There are no connected runners to update models');
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
      return [{ id: 'default', label: 'Default' }, ...options.filter(r => r.id !== 'default')];
    }
    if (modelId !== 'default' && this.selectedService() === 'codex') {
      return [
        { id: 'default', label: 'Default' },
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' },
        { id: 'xhigh', label: 'Extra high (XHigh)' }
      ];
    }
    if (modelId === 'default') {
      return [
        { id: 'default', label: 'Default' },
        { id: 'high', label: 'High' },
        { id: 'medium', label: 'Medium' },
        { id: 'low', label: 'Low' },
        ...(this.selectedService() === 'codex' ? [{ id: 'xhigh', label: 'Extra high (XHigh)' }] : [])
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
    this.clock=setInterval(()=>{this.now.set(Date.now());if(this.loggedIn()&&this.page()==='operations'&&Math.floor(Date.now()/1000)%5===0){void this.refreshTasks();void this.refreshUsageSummary();}},1000);
    if(typeof window !== 'undefined'){
      window.addEventListener('dragover', this.preventWindowDrop);
      window.addEventListener('drop', this.preventWindowDrop);
      window.addEventListener('resize', this.onViewportResize);
      document.addEventListener('focusin', this.onViewportResize);
      document.addEventListener('focusout', this.onViewportResize);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this.onViewportResize);
        window.visualViewport.addEventListener('scroll', this.onViewportResize);
      }
    }
    this.onViewportResize();
    this.restore();
  }
  ngOnDestroy(){
    this.closePreview();
    this.socket?.disconnect();
    if(this.clock)clearInterval(this.clock);
    if(this.scrollRaf)cancelAnimationFrame(this.scrollRaf);
    this.cleanupResizeObserver();
    if(this.smoothScrollTimeout)clearTimeout(this.smoothScrollTimeout);
    if(typeof window !== 'undefined'){
      window.removeEventListener('dragover', this.preventWindowDrop);
      window.removeEventListener('drop', this.preventWindowDrop);
      window.removeEventListener('resize', this.onViewportResize);
      document.removeEventListener('focusin', this.onViewportResize);
      document.removeEventListener('focusout', this.onViewportResize);
      if (this.viewportRaf !== undefined) cancelAnimationFrame(this.viewportRaf);
      document.documentElement.classList.remove('keyboard-open');
      document.documentElement.style.removeProperty('--app-height');
      document.documentElement.style.removeProperty('--app-top');
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.onViewportResize);
        window.visualViewport.removeEventListener('scroll', this.onViewportResize);
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
          ? (r.status === 404 ? 'The requested resource was not found' : `Server error ( ${r.status})`)
          : 'Invalid server response (JSON expected)'
      ) as Error & { status: number };
      error.status = r.status;
      throw error;
    }
    if(!r.ok){
      const error=new Error(body?.error||`Request error ( ${r.status})`) as Error&{status:number};
      error.status=r.status;
      throw error;
    }
    return body as T;
  }
  toggleSidebar() {
    this.sidebarOpen.update(v => !v);
  }
  formatChatsCount(n: number): string {
    return `${n} ${n === 1 ? 'chat' : 'chats'}`;
  }
  async refreshUsers(){if(!this.isOwner())return;try{this.users.set(await this.api<{id:string;username:string;createdAt:string}[]>('/users'));this.userAdminError='';}catch(e){this.userAdminError=(e as Error).message;}}
  async createUser(){this.userAdminError='';this.userAdminNotice='';try{await this.api('/users',{method:'POST',body:JSON.stringify({username:this.newUsername,password:this.newUserPassword})});this.newUsername='';this.newUserPassword='';this.userAdminNotice='User created';await this.refreshUsers();}catch(e){this.userAdminError=(e as Error).message;}}
  async resetUserPassword(id:string){const password=window.prompt('New password (minimum 12 characters)');if(password===null)return;try{await this.api(`/users/${encodeURIComponent(id)}/password`,{method:'PUT',body:JSON.stringify({password})});this.userAdminNotice='Password updated';this.userAdminError='';}catch(e){this.userAdminError=(e as Error).message;}}
  async removeUser(id:string,username:string){if(!window.confirm(`Delete user ${username}?`))return;try{await this.api(`/users/${encodeURIComponent(id)}`,{method:'DELETE'});this.userAdminNotice='User deleted';await this.refreshUsers();}catch(e){this.userAdminError=(e as Error).message;}}

  toggleProjectExpand(nameOrId: string) {
    this.expandedProjects.update(set => {
      const next = new Set(set);
      if (next.has(nameOrId)) next.delete(nameOrId);
      else next.add(nameOrId);
      return next;
    });
  }

  async restore(){
    let me:{username:string;isOwner:boolean};
    try{me=await this.api<{username:string;isOwner:boolean}>('/me');}
    catch(e){
      return;
    }
    this.username=me.username;this.isOwner.set(!!me.isOwner);this.loggedIn.set(true);this.connect();
    try{await this.load();const linked=new URLSearchParams(location.search).get('session');if(linked)await this.openSession(linked);}catch(e){this.error.set((e as Error).message);}
  }
  async login(){this.loginError='';try{const me=await this.api<{username:string;isOwner:boolean}>(this.registerMode()?'/register':'/login',{method:'POST',body:JSON.stringify({username:this.loginName,password:this.password})});this.username=me.username;this.isOwner.set(!!me.isOwner);this.password='';this.loggedIn.set(true);await this.load();this.connect();const linked=new URLSearchParams(location.search).get('session');if(linked)await this.openSession(linked);}catch(e){this.loginError=(e as Error).message;}}
  async logout(){await this.api('/logout',{method:'POST'}).catch(()=>{});this.socket?.disconnect();this.browserNotifications.set(false);this.closePreview();this.fileGroups.set([]);this.telegram.set(null);this.telegramLink.set('');this.managedRunner.set(null);this.modelBlacklist.set([]);this.isOwner.set(false);this.users.set([]);this.grants.set([]);this.grantEditor.set(false);this.loggedIn.set(false);this.current.set(null);}
  async load(){
    const [accounts,runners,projects,sessions,blacklistRes]=await Promise.all([
      this.api<Account[]>('/accounts'),
      this.api<Runner[]>('/runners'),
      this.api<Project[]>('/projects'),
      this.api<ChatSession[]>('/sessions'),
      this.api<{blacklist:string[]}>('/user/model-blacklist').catch(()=>({blacklist:[]}))
    ]);
    this.accounts.set(accounts);
    void this.refreshGrants();
    this.runners.set(runners);
    this.projects.set(projects);
    if(blacklistRes?.blacklist){
      this.modelBlacklist.set(blacklistRes.blacklist);
    }
    this.selectedService.set('auto');
    this.selectedAccount='auto';
    const available=this.models();
    if(!available.some(m=>m.id===this.selectedModel()))this.selectedModel.set('default');
    this.validateReasoning();
    this.selectedRunner=runners.find(r=>!r.revokedAt)?.id||'';
    const cleanSessions=sortSessions(sessions);
    this.sessions.set(cleanSessions);
    void this.refreshPreviews();
    this.current.set(null);
    this.page.set('projects');
  }
  async refreshAccounts(){this.accounts.set(await this.api<Account[]>('/accounts'));}
  async refreshRunners(){const rows=await this.api<Runner[]>('/runners');this.runners.set(rows);const managed=this.managedRunner();if(managed)this.managedRunner.set(rows.find(row=>row.id===managed.id)||null);await this.refreshAccounts();if(!this.selectedRunner)this.selectedRunner=this.runners().find(r=>!r.revokedAt)?.id||'';}
  newSession(){
    this.mobileMenu.set(false);
    this.current.set(null);
    this.taskFiles.set([]);
    this.selectedTaskFiles.set(new Set());
    this.sharedFileLinks.set({});
    this.collapsedDirs.set(new Set());
    this.filesFilter.set('');
    this.filesOpen.set(false);

    this.page.set('chat');
    this.resetRun();
    this.error.set('');
    this.ensureChatScrollAttached(true);
  }
  async openSession(id:string){
    this.mobileMenu.set(false);
    try{
      const s=await this.api<ChatSession>('/sessions/'+id);
      this.current.set(s);
      this.taskFiles.set([]);
      this.selectedTaskFiles.set(new Set());
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
  async refreshTaskFiles(){const id=this.current()?.id;if(!id)return;this.filesLoading.set(true);try{const result=await this.api<{files:{name:string;size:number;modified:string}[]}>(`/sessions/${id}/files`);if(this.current()?.id===id){this.taskFiles.set(result.files);const names=new Set(result.files.map(f=>f.name));this.selectedTaskFiles.update(selected=>new Set([...selected].filter(name=>names.has(name))));}}catch(e){if(this.filesOpen())this.error.set((e as Error).message);}finally{this.filesLoading.set(false);}}
  toggleTaskFiles(){this.filesOpen.update(open=>!open);if(this.filesOpen())void this.refreshTaskFiles();}
  async deleteTaskFile(name:string){const id=this.current()?.id;if(id)await this.deleteFiles([{kind:'sessions',id,name}]);}
  async deleteSelectedTaskFiles(){const id=this.current()?.id;if(id)await this.deleteFiles([...this.selectedTaskFiles()].map(name=>({kind:'sessions' as const,id,name})));}
  async shareTaskFile(name:string,download=false){const id=this.current()?.id;if(!id)return;try{const result=await this.api<{url:string;expiresAt:string}>(`/sessions/${id}/files/share`,{method:'POST',body:JSON.stringify({name})});const url=new URL(result.url,window.location.origin).href;if(this.current()?.id!==id)return;this.sharedFileLinks.update(links=>({...links,[name]:url}));if(download){const anchor=document.createElement('a');anchor.href=url;anchor.download=name.split('/').pop()||name;document.body.appendChild(anchor);anchor.click();anchor.remove();return;}try{await this.copy(url,'share-'+name);this.notice.set('Link copied. Valid for 7 days.');}catch{this.notice.set('The link is ready. Copy it from the list of files.');}}catch(e){this.error.set((e as Error).message);}}
  formatFileSize(bytes?: number): string {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
  pluralizeFiles(count: number): string {
    return count === 1 ? 'file' : 'files';
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
    const all = sortSessions(this.sessions()).filter(s=>!s.projectId);
    if (!query) return all;
    return all.filter(s => s.title.toLowerCase().includes(query));
  });

  filteredProjects = computed(() => {
    const query = this.sidebarSearch().trim().toLowerCase();
    const all = this.projects();
    if (!query) return all;
    return all.filter(p => p.name.toLowerCase().includes(query));
  });
  projectRunner(project:Project){if(project.shared)return 'Shared across runners';return this.runners().find(r=>r.id===project.runnerId)?.name||'Runner';}
  selectProject(id:string){this.selectedProjectId.set(id);const latest=this.chatsFor(id)[0];if(latest)void this.openSession(latest.id);else this.newSession();}
  newSessionFor(projectId:string){this.selectedProjectId.set(projectId);this.newSession();}
  createProject(){
    this.newProjectName='';this.newProjectShared=false;this.newProjectMembers='';
    this.newProjectRunner=this.selectedRunner || this.runners().find(r=>!r.revokedAt)?.id || '';
    this.projectCreateError.set('');
    this.projectCreateOpen.set(true);
    setTimeout(()=>document.getElementById('project-name')?.focus(),0);
  }
  trapDialogFocus(event:Event){
    const keyboard=event as KeyboardEvent;
    const dialog=event.currentTarget as HTMLElement;
    const focusable=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'));
    const first=focusable[0],last=focusable[focusable.length-1];
    if(keyboard.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!keyboard.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
  }
  closeProjectDialog(){if(!this.projectSaving())this.projectCreateOpen.set(false);}
  async saveProject(){
    const name=this.newProjectName.trim();
    const runnerId=this.newProjectRunner;
    if(!name || this.projectSaving())return;
    if(!runnerId){this.projectCreateError.set('First, connect a runner in the “Runners” section.');return;}
    this.projectSaving.set(true);this.projectCreateError.set('');
    try{
      const project=await this.api<Project>('/projects',{method:'POST',body:JSON.stringify({name,runnerId,shared:this.newProjectShared,members:this.newProjectShared?this.memberNames(this.newProjectMembers):[]})});
      this.projects.update(v=>[project,...v]);this.selectTaskProject(project.id);this.projectCreateOpen.set(false);this.newSession();
    }catch(e){this.projectCreateError.set((e as Error).message);}
    finally{this.projectSaving.set(false);}
  }

  memberNames(value:string){return [...new Set(value.split(/[\s,;]+/).map(v=>v.trim()).filter(Boolean))];}
  async showProjectMembers(project:Project){
    this.membersProject.set(project);this.membersLoading.set(true);this.membersError.set('');this.projectMembers.set([]);this.membersCanManage.set(false);this.editProjectMembers='';
    try{const result=await this.api<{members:{id:string;username:string;owner:boolean}[];canManage:boolean}>('/projects/'+project.id+'/members');this.projectMembers.set(result.members);this.membersCanManage.set(result.canManage);this.editProjectMembers=result.members.filter(m=>!m.owner).map(m=>m.username).join(', ');}catch(e){this.membersError.set((e as Error).message);}finally{this.membersLoading.set(false);}
  }
  closeMembersDialog(){if(!this.membersSaving())this.membersProject.set(null);}
  async saveProjectMembers(){
    const project=this.membersProject();if(!project||!this.membersCanManage()||this.membersSaving())return;
    this.membersSaving.set(true);this.membersError.set('');
    try{const updated=await this.api<Project>('/projects/'+project.id+'/members',{method:'PUT',body:JSON.stringify({members:this.memberNames(this.editProjectMembers)})});this.projects.update(list=>list.map(p=>p.id===updated.id?updated:p));this.membersProject.set(null);}catch(e){this.membersError.set((e as Error).message);}finally{this.membersSaving.set(false);}
  }

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
    let currentSession = this.current();
    if (!currentSession) {
      const projectId = this.selectedProjectId() || undefined;
      currentSession = await this.api<ChatSession>('/sessions', {method:'POST', body:JSON.stringify(projectId ? {projectId} : {})});
      this.current.set(currentSession);
    }
    if (currentSession.projectId) return currentSession.projectId;

    let projectId = this.selectedProjectId();
    if (!projectId && this.projects().length > 0) {
      projectId = this.projects()[0].id;
    }

    if (!projectId) {
      const activeRunner = this.runners().find(r => !r.revokedAt);
      if (!activeRunner) {
        throw new Error('Connect a runner to upload files');
      }
      const newProj = await this.api<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Main project', runnerId: activeRunner.id })
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
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to link files to project');
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
          errors.push(`“${file.name}” exceeds 20 MB`);
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
          this.notice.set(`Uploading files (${i + 1}/${rawFiles.length}): “${finalName}”...`);
        } else {
          this.notice.set(`Uploading “${finalName}”...`);
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
            throw new Error(body.error || `Failed to upload “${finalName}”`);
          }
          uploadedNames.push(body.name || finalName);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : `Upload error for “${finalName}”`);
        }
      }

      if (uploadedNames.length > 0) {
        this.mentionFiles(uploadedNames);
        this.filesOpen.set(true);
        await this.refreshTaskFiles();
        if (uploadedNames.length === 1) {
          this.notice.set(`File “${uploadedNames[0]}” added to the project and mentioned in the message`);
        } else {
          this.notice.set(`Uploaded ${uploadedNames.length} files to the project and mentioned in the message`);
        }
      }

      if (errors.length > 0) {
        this.error.set(errors.join(' · '));
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to upload files');
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
  showPage(page:'chat'|'projects'|'sites'|'providers'|'connections'|'runners'|'users'|'files'|'notifications'|'operations'){
    if(page==='users'&&!this.isOwner())return;
    this.page.set(page);
    this.mobileMenu.set(false);
    if(page==='runners')this.refreshRunners();
    else this.managedRunner.set(null);
    if(page==='connections'){void this.refreshAccounts();void this.refreshGrants();}
    if(page==='operations'){void this.refreshTasks();void this.refreshUsageSummary();}
    if(page==='files')void this.refreshLibrary();
    if(page==='notifications')void this.refreshTelegram();
    if(page==='sites')void this.refreshPreviews();
    if(page==='providers')void this.refreshProviders();
    if(page==='users')void this.refreshUsers();
    if(page==='chat')this.ensureChatScrollAttached(true);
    else this.cleanupResizeObserver();
  }
  async refreshPreviews(){try{const rows=await Promise.all(this.runners().filter(r=>!r.revokedAt).map(r=>this.api<Preview[]>('/runners/'+r.id+'/previews')));this.previews.set(rows.flat().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}catch(e){if(this.page()==='sites')this.error.set((e as Error).message);}}
  async setPreviewVisible(preview:Preview,visible:boolean){try{await this.api('/runners/'+preview.runnerId+'/previews/'+preview.subdomain,{method:'PATCH',body:JSON.stringify({visible})});await this.refreshPreviews();this.notice.set(visible?'The site is open':'Site hidden');}catch(e){this.error.set((e as Error).message);}}
  previewRunner(preview:Preview){return this.runners().find(r=>r.id===preview.runnerId)?.name||'Runner';}
  connect(){this.socket?.disconnect();this.socket=io({path:'/socket.io',transports:['websocket']});this.socket.on('connect',()=>{if(this.error()==='The connection to the server is lost')this.error.set('');void this.refreshTasks();const id=this.current()?.id;if(id)this.syncRun(id);});this.socket.on('queue:changed',()=>void this.refreshTasks());this.socket.on('disconnect',()=>{if(this.running())this.notice.set('Connection lost. Restoring the task status...');});this.socket.on('ai:event',(e:AIEvent)=>this.onEvent(e));this.socket.on('accounts:changed',(a:Account[])=>{this.accounts.set(a);const available=this.models();if(!available.some(m=>m.id===this.selectedModel()))this.selectedModel.set('default');this.validateReasoning();});this.socket.on('connect_error',()=>this.error.set('The connection to the server is lost'));}
  resetRun(){this.steeringAvailable.set(false);this.running.set(false);this.runId.set('');this.stream.set('');this.activeAccount.set('');this.activeProvider.set(undefined);this.activity.set([]);this.runStartedAt.set('');}
  syncRun(sessionId:string){if(!this.socket?.connected)return;this.socket.emit('run:state',sessionId,(state:RunState|null)=>{if(this.current()?.id!==sessionId)return;if(!state){const wasRunning=this.running();this.resetRun();this.notice.set('');if(wasRunning)this.notice.set('Connection restored. Check saved progress below.');void this.refreshTasks();void this.reloadCurrent();return;}if('type' in state){const wasRunning=this.running()||this.runId()===state.runId;this.resetRun();this.notice.set('');if(wasRunning){if(state.type==='error')this.error.set(state.message);else{this.error.set('');this.notice.set(state.message||'Done');}}void this.reloadCurrent();return;}this.steeringAvailable.set(state.steeringAvailable===true);this.runId.set(state.runId);this.running.set(true);this.runStartedAt.set(state.startedAt);this.lastActivityAt.set(state.lastActivityAt||state.activity?.at(-1)?.at||state.startedAt);this.activeAccount.set(state.accountId||'');if(state.provider)this.activeProvider.set(state.provider);this.stream.set(state.stream||'');this.activity.set(state.activity||[]);this.notice.set(state.message||'Task in progress');this.error.set('');this.requestScrollToBottom();});}
  onEvent(e:AIEvent){
    if(e.type==='completed'&&this.browserNotifications()&&'Notification' in window&&Notification.permission==='granted'&&(document.hidden||e.sessionId!==this.current()?.id||this.page()!=='chat')){const n=new Notification('The answer is ready',{body:this.sessions().find(s=>s.id===e.sessionId)?.title||'AI Router'});n.onclick=()=>{window.focus();void this.openSession(e.sessionId);n.close();};}
    if(e.sessionId!==this.current()?.id)return;
    this.lastActivityAt.set(e.at||new Date().toISOString());
    if(e.type==='fallback'||e.type==='handoff_started')this.steeringAvailable.set(false);
    if(typeof e.data?.steeringAvailable==='boolean')this.steeringAvailable.set(e.data.steeringAvailable);
    if(e.data?.steeringMessage){const message=e.data.steeringMessage;this.current.update(s=>s&&!s.messages.some(m=>m.id===message.id)?{...s,messages:[...s.messages,message],updatedAt:message.at||s.updatedAt}:s);}
if(e.provider)this.activeProvider.set(e.provider as ProviderId);if(e.type==='started'){this.running.set(true);this.runId.set(e.runId);this.runStartedAt.set(new Date().toISOString());this.activity.set([]);this.notice.set(e.message||'Request accepted');void this.reloadCurrent();this.requestScrollToBottom();}else if(e.type==='delta'){this.stream.update(s=>s+(e.text||''));this.activeAccount.set(e.data?.accountId||'');this.requestScrollToBottom();}else if(e.type==='status'||e.type==='tool'||e.type==='fallback'||e.type==='checkpoint'||e.type==='handoff_started'||e.type==='handoff_ready'){if(e.type==='handoff_started')this.stream.set('');if(e.message){this.notice.set(e.message);this.activity.update(rows=>[...rows,{type:e.type,message:e.message!,at:new Date().toISOString(),provider:e.provider as ProviderId,accountId:e.data?.accountId}].slice(-12));}this.activeAccount.set(e.data?.accountId||this.activeAccount());this.requestScrollToBottom();}else if(e.type==='error'){this.error.set(e.message||'Error');this.resetRun();this.reloadCurrent();}else if(e.type==='completed'){this.resetRun();this.notice.set(e.message||'Done');this.reloadCurrent();void this.refreshTaskFiles();}}
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
  async send(enqueue=false){
    const prompt=this.draft.trim();
    if(this.running()&&!enqueue){await this.steer();return;}
    if(!prompt||this.taskSubmitting())return;
    if(!this.socket?.connected){this.error.set('The connection to the server is lost');return;}
    this.taskSubmitting.set(true);
    try{
      let chat=this.current();
      if(!chat?.id){const projectId=this.selectedProjectId()||undefined;chat=await this.api<ChatSession>('/sessions',{method:'POST',body:JSON.stringify(projectId?{projectId}:{})});this.current.set(chat);}
      const service=this.selectedService();
      const ack=await this.socket.timeout(15000).emitWithAck('run',{sessionId:chat.id,prompt,service,accountId:service,model:this.selectedModel(),reasoning:this.selectedReasoning(),fast:service==='codex'&&this.codexFast(),mode:'task'});
      if(!ack.ok)throw new Error(ack.error||'Unable to queue task');
      this.draft='';this.error.set('');if(!this.running())this.notice.set('Task added to queue');setTimeout(()=>this.adjustTextareaHeight(),0);await this.refreshTasks();
    }catch(e){this.error.set((e as Error).message);}finally{this.taskSubmitting.set(false);}
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
      this.notice.set(isApi?'The connection has been created. Enter the API key in its card.':'Account added. Run the login command on your container.');
    }catch(e){this.error.set((e as Error).message);}finally{this.addingAccount.set(false);}
  }
  async saveOpenAIKey(a:Account){
    if(this.savingApiKey())return;
    const apiKey=(this.apiKeyDrafts[a.id]||'').trim();if(!apiKey)return;
    this.savingApiKey.set(a.id);this.error.set('');
    try{await this.api('/accounts/'+a.id+'/api-key',{method:'PUT',body:JSON.stringify({apiKey})});this.apiKeyDrafts[a.id]='';await this.refreshAccounts();this.notice.set('The API key has been saved. Models will appear in the Codex selection after the status update.');}
    catch(e){this.error.set((e as Error).message);}finally{this.savingApiKey.set('');}
  }
  async assignAccount(a:Account,runnerId:string){try{await this.api('/accounts/'+a.id,{method:'PATCH',body:JSON.stringify({runnerId})});await this.refreshAccounts();}catch(e){this.error.set((e as Error).message);}}
  async setAccountPriority(a:Account,value:string){
    const priority=Number(value);
    if(priority!==0&&priority!==1&&priority!==2)return;
    try{
      await this.api('/accounts/'+a.id+'/priority',{method:'PATCH',body:JSON.stringify({priority})});
      await this.refreshAccounts();
      this.notice.set('Account priority preserved');
    }catch(e){this.error.set((e as Error).message);await this.refreshAccounts();}
  }
  async removeAccount(a:Account){
    if(this.deletingAccount()||!window.confirm(`Delete connection “${a.name}”? Login data and the API key on the runner will be deleted.`))return;
    this.deletingAccount.set(a.id);this.error.set('');
    try{await this.api('/accounts/'+encodeURIComponent(a.id),{method:'DELETE'});delete this.apiKeyDrafts[a.id];await this.refreshAccounts();this.notice.set('Connection deleted');}
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

  async createPairing(){this.error.set('');try{this.pairing.set(await this.api<Pairing>('/runners/pairing',{method:'POST',body:JSON.stringify({name:this.runnerName})}));}catch(e){this.error.set((e as Error).message);}}
  async revokeRunner(r:Runner){if(!confirm(`Disable ${r.name}? Its tasks will stop.`))return;try{await this.api('/runners/'+r.id,{method:'DELETE'});await this.refreshRunners();}catch(e){this.error.set((e as Error).message);}}
  loginCommand(a:Account){return `docker compose -f runner/compose.yaml exec runner /app/scripts/provider-login.sh ${a.provider} ${a.id}`;}
  async copy(text:string, id:string=''){
    await navigator.clipboard.writeText(text);
    if(id){
      this.copiedId.set(id);
      setTimeout(()=>{if(this.copiedId()===id)this.copiedId.set('');},2000);
    }
    this.notice.set('Copied to clipboard');
  }
  accountLabel(id:string){return this.accounts().find(a=>a.id===id)?.name||'';}
  providerLabel(id?:ProviderId|string){return id==='codex'?'Codex':(id==='antigravity'||id==='gemini')?'Gemini':id==='chatgpt'?'ChatGPT':'';}
  tokenLabel(usage?:TokenUsage){return usage?`${new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(usage.totalTokens)} tokens`:'— tokens';}
  tokenTitle(usage?:TokenUsage){
    if(!usage)return 'The provider did not transmit the token consumption for this request';
    const format=(value:number)=>new Intl.NumberFormat('en-US').format(value);
    const rows=[`Total per request: ${format(usage.totalTokens)} tokens`];
    if(usage.inputTokens!==undefined)rows.push(`Input: ${format(usage.inputTokens)}`);
    if(usage.outputTokens!==undefined)rows.push(`Output: ${format(usage.outputTokens)}`);
    if(usage.cachedInputTokens!==undefined)rows.push(`Cached input: ${format(usage.cachedInputTokens)}`);
    if(usage.reasoningOutputTokens!==undefined)rows.push(`Reasoning: ${format(usage.reasoningOutputTokens)}`);
    return rows.join('\n');
  }
  resettingAccount=signal('');
  resetAttempts=new Map<string,string>();
  async useAccountReset(a:Account){
    if(this.resettingAccount()||a.shared||a.mode!=='runner'||!a.limit.resetCredits?.availableCount)return;
    if(!window.confirm('Use one reset for '+a.name+' to restore the Codex usage limits?'))return;
    this.resettingAccount.set(a.id);this.error.set('');
    try{
      const storageKey='account-reset-attempt:'+a.id;
      const key=this.resetAttempts.get(a.id)||sessionStorage.getItem(storageKey)||crypto.randomUUID();
      this.resetAttempts.set(a.id,key);sessionStorage.setItem(storageKey,key);
      const result=await this.api<{outcome:string}>('/accounts/'+encodeURIComponent(a.id)+'/reset',{method:'POST',body:JSON.stringify({idempotencyKey:key})});
      this.resetAttempts.delete(a.id);sessionStorage.removeItem(storageKey);
      const messages:Record<string,string>={reset:'Reset applied. Account limits are refreshing.',nothingToReset:'The account limits do not need a reset.',noCredit:'No resets available. Account status is refreshing.',alreadyRedeemed:'This reset attempt was already applied. Account status is refreshing.'};
      this.notice.set(messages[result.outcome]||'Account status is refreshing.');
      await this.refreshAccounts();if(this.page()==='operations')await this.refreshUsageSummary();
    }catch(e){this.error.set((e as Error).message);}
    finally{this.resettingAccount.set('');}
  }
  resetExpiry(expiresAt:string|null){
    if(expiresAt===null)return 'No expiry';
    const date=new Date(expiresAt);if(!Number.isFinite(date.getTime()))return 'Expiry unavailable';
    return (date.getTime()<=this.now()?'Expired ':'Expires ')+new Intl.DateTimeFormat('en-US',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
  }
  limitLabel(a:Account){if(a.limit.cooldownUntil)return 'Limited';if(a.limit.primary||a.limit.secondary)return 'Account quota';return 'Provider';}
  windowLabel(window:UsageWindow){const minutes=window.windowMinutes;if(minutes===300)return '5 h';if(minutes===10080)return 'Week';if(minutes===43200)return 'Month';if(minutes&&minutes%60===0)return `${minutes/60} h`;return 'Window';}
  remaining(window:UsageWindow|null){return window?`${Math.round(window.remainingPercent)}%`:'';}
  resetLabel(window:UsageWindow){if(!window.resetAt)return '';const date=new Date(window.resetAt);return Number.isFinite(date.getTime())?`Resets ${new Intl.DateTimeFormat('en-US',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(date)}`:'';}
  accountMode(a:Account){return a.mode==='runner'?'Container online':a.mode==='offline'?'Offline':'No container';}
  hasAccountsFor(service:ServiceId):boolean{const accounts=Array.isArray(this.accounts()) ? this.accounts() : [];if(service==='auto')return accounts.length>0;const provider:ProviderId=service==='gemini'?'antigravity':service==='codex'?'codex':'chatgpt';const pId=this.current()?.projectId || this.selectedProjectId();const project=pId?this.projects().find(p=>p.id===pId):null;const list=project&&!project.shared?accounts.filter(a=>a.runnerId===project.runnerId):accounts;return list.some(a=>a.provider===provider);}
  selectTaskProject(id:string){this.selectedProjectId.set(id);this.selectService(this.selectedService());}
  selectService(service:ServiceId){this.selectedService.set(service);this.selectedAccount=service;const available=this.models();if(!available.some(m=>m.id===this.selectedModel()))this.selectedModel.set('default');this.validateReasoning();}
  selectAccount(id:string){this.selectedAccount=id;this.selectedModel.set('default');this.selectedReasoning.set('default');}
  selectModel(id:string){
    this.selectedModel.set(id);
    if(id!=='default'){
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
      this.notice.set('ChatGPT session saved successfully!');
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
      if (label) label.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        if (label) label.textContent = 'Copy';
      }, 2000);
      this.notice.set('The code has been copied to the clipboard');
    }).catch(() => {
      this.notice.set('Failed to copy code');
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
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (window.matchMedia('(pointer: coarse)').matches && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    void this.send();
  }

  adjustTextareaHeight() {
    const el = this.composerTextareaRef?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }

}
