import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';

interface Run { id:number; repository:string; name:string; title:string; branch:string; sha:string; status:string; conclusion:string|null; url:string; createdAt:string; updatedAt:string; }
interface Job { id:number; name:string; status:string; conclusion:string|null; steps:{number:number;name:string;status:string;conclusion:string|null}[]; }
@Component({
  selector:'app-github-page',standalone:true,imports:[CommonModule,FormsModule],
  templateUrl:'./github-page.html',styleUrl:'./github-page.css',
})
export class GithubPageComponent implements OnInit,OnDestroy {
  private api=inject(ApiService);
  connected=signal(false);login=signal('');loading=signal(false);ready=signal(false);error=signal('');
  token='';repository='';query=signal('');activeOnly=signal(false);
  repositories=signal<{id:number;full_name:string;private:boolean}[]>([]);
  runs=signal<Run[]>([]);warnings=signal<{repository:string;error:string}[]>([]);updatedAt=signal('');
  expanded=signal<number|null>(null);jobs=signal<Job[]>([]);jobsError=signal('');jobsLoading=signal(false);
  private timer?:ReturnType<typeof setInterval>;private disposed=false;private generation=0;private detailGeneration=0;
  visible=computed(()=>this.runs().filter(r=>(!this.activeOnly()||r.status!=='completed')&&`${r.repository} ${r.name} ${r.title} ${r.branch}`.toLowerCase().includes(this.query().toLowerCase())));
  activeCount=computed(()=>this.runs().filter(r=>r.status!=='completed').length);
  async ngOnInit() {
    try {
      const status=await this.api.request<{connected:boolean;login:string}>('/github');
      if(this.disposed)return;this.connected.set(status.connected);this.login.set(status.login);
      if(status.connected)await this.loadRepositories();
    }catch(e){this.error.set((e as Error).message);}finally{this.ready.set(true);}
    if(!this.disposed)this.timer=setInterval(()=>{if(!document.hidden&&this.connected()&&!this.loading()){void this.refresh();}},30000);
  }
  async connect() {
    if(this.loading()||!this.token.trim())return;this.loading.set(true);this.error.set('');
    const token=this.token.trim();this.token='';
    try {
      const status=await this.api.request<{login:string}>('/github',{method:'POST',body:JSON.stringify({token})});
      if(this.disposed)return;this.connected.set(true);this.login.set(status.login);await this.loadRepositories();
    }catch(e){this.error.set((e as Error).message);}finally{this.loading.set(false);}
  }
  async disconnect() {
    this.loading.set(true);this.error.set('');
    try {
      await this.api.request('/github',{method:'DELETE'});this.generation++;this.detailGeneration++;
      this.connected.set(false);this.login.set('');this.repositories.set([]);this.runs.set([]);this.warnings.set([]);this.expanded.set(null);this.jobs.set([]);this.updatedAt.set('');this.repository='';
    }catch(e){this.error.set((e as Error).message);}finally{this.loading.set(false);}
  }
  async loadRepositories() {
    const rows=await this.api.request<{id:number;full_name:string;private:boolean}[]>('/github/repositories');
    if(this.disposed)return;this.repositories.set(rows);await this.refresh();
  }
  async refresh() {
    const generation=++this.generation;this.loading.set(true);this.error.set('');
    try {
      const [data,repos]=await Promise.all([this.api.request<{runs:Run[];errors:{repository:string;error:string}[];updatedAt:string}>('/github/runs'+(this.repository?'?repository='+encodeURIComponent(this.repository):'')),this.api.request<{id:number;full_name:string;private:boolean}[]>('/github/repositories')]);
      if(this.disposed||generation!==this.generation)return;
      this.repositories.set(repos);this.runs.set(data.runs);this.warnings.set(data.errors);this.updatedAt.set(data.updatedAt);
      const expanded=this.expanded(),run=data.runs.find(r=>r.id===expanded);
      if(run)void this.loadJobs(run);else this.expanded.set(null);
    }catch(e){if(generation===this.generation)this.error.set((e as Error).message);}
    finally{if(generation===this.generation)this.loading.set(false);}
  }
  selectRepository() { this.expanded.set(null);this.detailGeneration++;void this.refresh(); }
  toggle(run:Run) {
    this.detailGeneration++;
    if(this.expanded()===run.id){this.expanded.set(null);return;}
    this.expanded.set(run.id);this.jobs.set([]);void this.loadJobs(run);
  }
  private async loadJobs(run:Run) {
    const generation=++this.detailGeneration;this.jobsLoading.set(true);this.jobsError.set('');
    try {
      const data=await this.api.request<{jobs:Job[]}>(`/github/${run.repository}/runs/${run.id}/jobs`);
      if(!this.disposed&&generation===this.detailGeneration)this.jobs.set(data.jobs);
    }catch(e){if(generation===this.detailGeneration)this.jobsError.set((e as Error).message);}
    finally{if(generation===this.detailGeneration)this.jobsLoading.set(false);}
  }
  status(status:string,conclusion:string|null) {
    return ({in_progress:'In progress',queued:'Queued',waiting:'Waiting',pending:'Waiting',requested:'Requested',success:'Success',failure:'Failed',cancelled:'Cancelled',skipped:'Skipped',timed_out:'Timed out',action_required:'Action required',neutral:'Completed',completed:'Completed'} as Record<string,string>)[conclusion||status]||conclusion||status;
  }
  completedSteps(job:Job) { return job.steps.filter(s=>s.status==='completed').length; }
  ngOnDestroy() {this.disposed=true;this.generation++;this.detailGeneration++;this.token='';if(this.timer)clearInterval(this.timer);}
}
