import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AccountsService } from '../core/accounts.service';
import { CccAutoSettings, CccCandidate, defaultCccAutoSettings } from '../core/ccc-settings';

@Component({
  selector:'app-ccc-auto-page',
  standalone:true,
  imports:[FormsModule],
  templateUrl:'./ccc-auto-page.html',
  styleUrl:'./ccc-auto-page.css',
})
export class CccAutoPageComponent implements OnInit {
  readonly accounts=inject(AccountsService);
  private readonly api=inject(ApiService);
  settings:CccAutoSettings=defaultCccAutoSettings();
  loading=true; saving=false; error=''; notice=''; jsonDraft='';
  readonly reasonings=['default','none','minimal','low','medium','high','xhigh','max'];
  async ngOnInit(){
    try{const [settings]=await Promise.all([this.api.request<CccAutoSettings>('/ccc-auto/settings'),this.accounts.refreshAccounts()]);this.settings=settings;}
    catch(error){this.error=(error as Error).message;}
    finally{this.loading=false;}
  }
  candidateAccounts(c:CccCandidate){return this.accounts.accounts().filter(a=>a.provider===c.provider);}
  models(c:CccCandidate){return [...new Map(this.candidateAccounts(c).filter(a=>!c.accountId||a.id===c.accountId).flatMap(a=>a.models).filter(m=>m.id!=='default').map(m=>[m.id,m])).values()];}
  providerChanged(c:CccCandidate){c.accountId=undefined;c.model=c.provider==='codex'?'gpt-6.1-sol':c.provider==='openrouter'?'openrouter/auto':this.models(c).find(m=>m.id.startsWith('gemini-'))?.id ?? 'default';if(c.provider!=='codex'){c.fast=false;c.reasoning='default';}delete c.openRouterRouting;}
  candidateReasonings(c:CccCandidate){if(c.provider!=='antigravity')return this.reasonings;const model=this.models(c).find(m=>m.id===c.model);return ['default',...(model?.reasoning?.map(r=>r.id) ?? (c.model.startsWith('gemini-')?['low','medium','high','max']:[]))];}
  routingProviders(c:CccCandidate){return c.openRouterRouting?.only.join(', ') ?? '';}
  setRoutingProviders(c:CccCandidate,value:string){c.openRouterRouting={only:[...new Set(value.split(/[,\s]+/).filter(Boolean))],allowFallbacks:c.openRouterRouting?.allowFallbacks ?? true};}
  setRoutingFallbacks(c:CccCandidate,value:boolean){c.openRouterRouting={only:c.openRouterRouting?.only ?? [],allowFallbacks:value};}
  useGoogleFlex(c:CccCandidate){c.openRouterRouting={only:['google-ai-studio/flex'],allowFallbacks:false};}
  addCandidate(index:number){const row=this.settings.levels[index];if(row.candidates.length>=8)return;row.candidates.push({id:'candidate-'+Date.now().toString(36),enabled:true,provider:'codex',model:'gpt-6.1-sol',reasoning:'high',delaySeconds:30,mode:'code',fast:true});}
  removeCandidate(index:number,id:string){const row=this.settings.levels[index];if(row.candidates.length>1)row.candidates=row.candidates.filter(c=>c.id!==id);}
  copyCandidates(index:number){const candidates=this.settings.levels[index].candidates;for(const row of this.settings.levels)row.candidates=structuredClone(candidates);this.notice='Состав участников скопирован на все диапазоны. Нажмите «Сохранить».';}
  splitLast(){const last=this.settings.levels.at(-1)!;if(last.from>=100||this.settings.levels.length>=20)return;last.to=last.from;this.settings.levels.push({from:last.from+1,to:null,candidates:structuredClone(last.candidates)});}
  removeLast(){if(this.settings.levels.length<=1)return;this.settings.levels.pop();this.settings.levels.at(-1)!.to=null;}
  normalizeRanges(){let from=1;for(const rule of this.settings.levels){rule.from=from;from=(rule.to??100)+1;}}
  reset(){this.settings=defaultCccAutoSettings();this.notice='Стандартные настройки восстановлены в форме. Нажмите «Сохранить».';this.error='';}
  exportJson(){this.jsonDraft=JSON.stringify(this.settings,null,2);}
  async importJson(){try{this.settings=await this.api.request<CccAutoSettings>('/ccc-auto/settings/validate',{method:'POST',body:JSON.stringify(JSON.parse(this.jsonDraft))});this.notice='JSON загружен в форму. Проверка выполнится при сохранении.';this.error='';}catch(error){this.error=error instanceof SyntaxError?'Некорректный JSON':(error as Error).message;}}
  async save(){this.saving=true;this.error='';this.notice='';try{this.settings=await this.api.request<CccAutoSettings>('/ccc-auto/settings',{method:'PUT',body:JSON.stringify(this.settings)});this.notice='Сохранено. Новые задачи CCC-Auto используют эти настройки.';}catch(error){this.error=(error as Error).message;}finally{this.saving=false;}}
}
