import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express, RequestHandler } from 'express';

type Repo = { id:number; full_name:string; private:boolean };
export type WorkflowRun = { id:number; repository:string; name:string; title:string; branch:string; sha:string; status:string; conclusion:string|null; url:string; createdAt:string; updatedAt:string; attempt:number };
type Binding = { login:string; token:string };
export class GithubError extends Error {
  constructor(message:string, public status=502) { super(message); }
}

export class GithubActions {
  private key:Buffer;
  private cache = new Map<string,{until:number; value:Promise<unknown>}>();
  private cooldown = new Map<string,number>();
  constructor(private directory:string, secret:string, private request:typeof fetch=fetch) {
    this.key=createHash('sha256').update('github-actions:'+secret).digest();
  }
  private file(user:string) { return path.join(this.directory,createHash('sha256').update(user).digest('hex')+'.json'); }
  private async binding(user:string):Promise<Binding|null> {
    let raw:string;
    try { raw=await readFile(this.file(user),'utf8'); } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e; }
    try {
      const saved=JSON.parse(raw), decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(saved.iv,'base64'));
      decipher.setAAD(Buffer.from(user));decipher.setAuthTag(Buffer.from(saved.tag,'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(saved.data,'base64')),decipher.final()]).toString());
    } catch { throw new GithubError('Reconnect GitHub: the saved connection could not be read.',409); }
  }
  async status(user:string) { const value=await this.binding(user);return {connected:!!value,login:value?.login||''}; }
  async connect(user:string,token:string) {
    const account=await this.call<{login:string}>(token,'/user');
    if(!account.login)throw new GithubError('GitHub did not return an account.');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(user));
    const data=Buffer.concat([cipher.update(JSON.stringify({login:account.login,token})),cipher.final()]);
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const file=this.file(user),temp=file+'.'+randomBytes(8).toString('hex');
    await writeFile(temp,JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600});
    await rename(temp,file);this.cache.clear();
    return {connected:true,login:account.login};
  }
  async disconnect(user:string) { await unlink(this.file(user)).catch(e=>{if(e.code!=='ENOENT')throw e;});this.cache.clear(); }
  private async token(user:string) { const value=await this.binding(user);if(!value)throw new GithubError('Connect GitHub first.',409);return value.token; }
  private async call<T>(token:string,endpoint:string):Promise<T> {
    const fingerprint=createHash('sha256').update(token).digest('hex');
    const limited=()=>new GithubError('GitHub API rate limit reached. Wait before refreshing.',429);
    for(const [key,until] of this.cooldown)if(until<=Date.now())this.cooldown.delete(key);
    if((this.cooldown.get(fingerprint)||0)>Date.now())throw limited();
    let response:Response;
    try { response=await this.request('https://api.github.com'+endpoint,{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'AI-Router'},signal:AbortSignal.timeout(20000),redirect:'error'}); }
    catch { throw new GithubError('Could not reach GitHub. Try again.'); }
    if(!response.ok) {
      if(response.status===401)throw new GithubError('GitHub token expired or revoked. Reconnect GitHub.',401);
      if(response.status===429||response.status===403&&(response.headers.get('x-ratelimit-remaining')==='0'||response.headers.has('retry-after'))) {
        const retry=Number(response.headers.get('retry-after'))*1000,reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
        this.cooldown.set(fingerprint,Math.max(Date.now()+60000,Date.now()+(Number.isFinite(retry)?retry:0),Number.isFinite(reset)?reset:0));
        throw limited();
      }
      if(response.status===403||response.status===404)throw new GithubError('No Actions access. Check token permissions and organization SSO access.',403);
      throw new GithubError('GitHub returned an error ('+response.status+').');
    }
    return response.json() as Promise<T>;
  }
  private cached<T>(token:string,key:string,ttl:number,read:()=>Promise<T>):Promise<T> {
    const id=createHash('sha256').update(token).digest('hex')+':'+key,old=this.cache.get(id);
    if(old&&old.until>Date.now())return old.value as Promise<T>;
    for(const [key,item] of this.cache)if(item.until<Date.now())this.cache.delete(key);
    const value=read().catch(error=>{this.cache.delete(id);throw error;});
    this.cache.set(id,{until:Date.now()+ttl,value});return value;
  }
  private repos(token:string) { return this.cached(token,'repos',60000,async()=>{
    const result:Repo[]=[];
    for(let page=1;;page++) {
      const rows=await this.call<Repo[]>(token,`/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`);
      result.push(...rows.map(r=>({id:r.id,full_name:r.full_name,private:r.private})));if(rows.length<100)break;
    }
    return result;
  }); }
  async repositories(user:string) { return this.repos(await this.token(user)); }
  async runs(user:string,repository?:string) {
    const token=await this.token(user),repos=await this.repos(token);
    if(repository&&!repos.some(r=>r.full_name===repository))throw new GithubError('Repository is not accessible to this connection.',403);
    return this.cached(token,'runs:'+(repository||'*'),30000,async()=>{
      const selected=repository?repos.filter(r=>r.full_name===repository):repos;
      const runs:WorkflowRun[]=[],errors:{repository:string;error:string}[]=[];
      let cursor=0,stopped=false;
      await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{
        while(!stopped&&cursor<selected.length) {
          const repo=selected[cursor++];
          try {
            const data=await this.call<{workflow_runs:any[]}>(token,`/repos/${repo.full_name}/actions/runs?per_page=20`);
            runs.push(...data.workflow_runs.map(r=>({id:r.id,repository:repo.full_name,name:r.name||'Workflow',title:r.display_title||r.name||'Workflow',branch:r.head_branch||'',sha:(r.head_sha||'').slice(0,7),status:r.status,conclusion:r.conclusion,url:`https://github.com/${repo.full_name}/actions/runs/${r.id}`,createdAt:r.created_at,updatedAt:r.updated_at,attempt:r.run_attempt})));
          } catch(e) {
            if(e instanceof GithubError&&(e.status===401||e.status===429)){stopped=true;throw e;}
            errors.push({repository:repo.full_name,error:e instanceof Error?e.message:'GitHub unavailable'});
          }
        }
      }));
      runs.sort((a,b)=>Number(a.status==='completed')-Number(b.status==='completed')||Date.parse(b.createdAt)-Date.parse(a.createdAt));
      return {runs,errors,repositoryCount:selected.length,updatedAt:new Date().toISOString()};
    });
  }
  async jobs(user:string,repository:string,run:string) {
    const token=await this.token(user);
    if(!(await this.repos(token)).some(r=>r.full_name===repository))throw new GithubError('Repository is not accessible to this connection.',403);
    return this.cached(token,`jobs:${repository}:${run}`,10000,async()=>{
      const jobs:unknown[]=[];
      for(let page=1;;page++) {
        const data=await this.call<{jobs:any[]}>(token,`/repos/${repository}/actions/runs/${run}/jobs?per_page=100&page=${page}`);
        jobs.push(...data.jobs.map(j=>({id:j.id,name:j.name,status:j.status,conclusion:j.conclusion,startedAt:j.started_at,completedAt:j.completed_at,steps:(j.steps||[]).map((s:any)=>({number:s.number,name:s.name,status:s.status,conclusion:s.conclusion}))})));
        if(data.jobs.length<100)break;
      }
      return {jobs};
    });
  }
}

export function mountGithubActions(app:Express,auth:RequestHandler,github:GithubActions) {
  app.use('/api/github',auth);
  const route=(read:(req:any)=>Promise<unknown>):RequestHandler=>async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try { res.json(await read(req)); }catch(e){res.status(e instanceof GithubError?e.status:500).json({error:e instanceof GithubError?e.message:'GitHub connection could not be saved or read.'});}
  };
  app.get('/api/github',route(req=>github.status(req.session.userId)));
  app.post('/api/github',route(req=>{
    const token=req.body?.token;
    if(typeof token!=='string'||!/^\S{10,255}$/.test(token))throw new GithubError('Enter a valid GitHub personal access token.',400);
    return github.connect(req.session.userId,token);
  }));
  app.delete('/api/github',route(async req=>{await github.disconnect(req.session.userId);return {ok:true};}));
  app.get('/api/github/repositories',route(req=>github.repositories(req.session.userId)));
  app.get('/api/github/runs',route(req=>{
    if(req.query.repository!==undefined&&(typeof req.query.repository!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(req.query.repository)))throw new GithubError('Invalid repository.',400);
    return github.runs(req.session.userId,req.query.repository);
  }));
  app.get('/api/github/:owner/:repo/runs/:run/jobs',route(req=>{
    if(!/^[-\w.]+$/.test(req.params.owner)||!/^[-\w.]+$/.test(req.params.repo)||!/^\d+$/.test(req.params.run))throw new GithubError('Invalid workflow run.',400);
    return github.jobs(req.session.userId,req.params.owner+'/'+req.params.repo,req.params.run);
  }));
}
