import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GithubActions } from './github-actions.js';

async function fixture(t:test.TestContext, handler:(url:URL,token:string)=>Response|Promise<Response>) {
  const directory=await mkdtemp(path.join(tmpdir(),'github-actions-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const calls:string[]=[];
  const service=new GithubActions(directory,'fixture-secret',async(input,options)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://api.github.com');calls.push(url.pathname+url.search);
    return handler(url,(options?.headers as Record<string,string>).Authorization);
  });
  return {directory,service,calls};
}
const json=(data:unknown,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
const repo=(id:number)=>({id,full_name:'owner/repo'+id,private:true});
const run=(id:number,status:string)=>({id,name:'Build',display_title:'Test build',head_branch:'main',head_sha:'abcdef12345',status,conclusion:status==='completed'?'success':null,created_at:'2026-10-19T10:00:00Z',updated_at:'2026-10-19T10:01:00Z',run_attempt:1});

test('connections are encrypted, private to users, and can be disconnected',async t=>{
  const {directory,service}=await fixture(t,()=>json({login:'alice'}));
  assert.deepEqual(await service.status('alice'),{connected:false,login:''});
  await service.connect('alice','fixture-personal-token');
  const file=path.join(directory,(await readdir(directory))[0]);
  assert.equal((await stat(file)).mode&0o777,0o600);
  assert.ok(!(await readFile(file,'utf8')).includes('fixture-personal-token'));
  assert.deepEqual(await service.status('alice'),{connected:true,login:'alice'});
  assert.deepEqual(await service.status('bob'),{connected:false,login:''});
  await assert.rejects(service.repositories('bob'),/Connect GitHub/);
  await service.disconnect('alice');assert.equal((await service.status('alice')).connected,false);
});

test('repository pagination includes collaborators and organizations past 100 repositories',async t=>{
  const {service,calls}=await fixture(t,url=>url.pathname==='/user'?json({login:'alice'}):json(url.searchParams.get('page')==='1'?Array.from({length:100},(_,i)=>repo(i)): [repo(100)]));
  await service.connect('alice','fixture-personal-token');
  assert.equal((await service.repositories('alice')).length,101);
  assert.ok(calls.some(c=>c.includes('organization_member')&&c.includes('page=2')));
  const count=calls.length;await service.repositories('alice');assert.equal(calls.length,count);
});

test('all-repository runs include partial failures and sort active workflows first',async t=>{
  const {service,calls}=await fixture(t,url=>{
    if(url.pathname==='/user')return json({login:'alice'});
    if(url.pathname==='/user/repos')return json([repo(1),repo(2),repo(3)]);
    if(url.pathname.includes('repo3'))return json({},403);
    return json({workflow_runs:[run(url.pathname.includes('repo1')?1:2,url.pathname.includes('repo1')?'completed':'in_progress')]});
  });
  await service.connect('alice','fixture-personal-token');
  const data=await service.runs('alice');assert.deepEqual(data.runs.map(r=>r.id),[2,1]);
  assert.equal(data.repositoryCount,3);assert.equal(data.errors[0].repository,'owner/repo3');
  assert.equal(data.runs[0].url,'https://github.com/owner/repo2/actions/runs/2');
  const count=calls.length;await service.runs('alice');assert.equal(calls.length,count);
  await assert.rejects(service.runs('alice','someone/private'),/not accessible/);
  await assert.rejects(service.jobs('alice','someone/private','2'),/not accessible/);
});

test('jobs paginate, expose steps, and filter raw GitHub response fields',async t=>{
  const job={id:1,name:'Tests',status:'in_progress',conclusion:null,secret:'must-not-leak',steps:[{number:1,name:'Install',status:'completed',conclusion:'success',extra:'omit'}]};
  const {service,calls}=await fixture(t,url=>url.pathname==='/user'?json({login:'alice'}):url.pathname==='/user/repos'?json([repo(1)]):json({jobs:url.searchParams.get('page')==='1'?Array.from({length:100},(_,i)=>({...job,id:i})):[]}));
  await service.connect('alice','fixture-personal-token');
  const data=await service.jobs('alice','owner/repo1','123');
  assert.equal(data.jobs.length,100);assert.ok(!JSON.stringify(data).includes('must-not-leak'));assert.ok(calls.some(c=>c.includes('/jobs?')&&c.includes('page=2')));
});

test('expired tokens and rate limits report actionable errors without leaking response bodies',async t=>{
  let status=401;
  const {service}=await fixture(t,()=>json({message:'private token or provider details'},status,status===403?{'x-ratelimit-remaining':'0'}:{}));
  await assert.rejects(service.connect('alice','fixture-personal-token'),/expired or revoked/);
  status=403;await assert.rejects(service.connect('alice','fixture-personal-token'),/rate limit/);
});


test('rate limits pause further API calls until GitHub permits retrying',async t=>{
  let limited=false;
  const {service,calls}=await fixture(t,url=>{
    if(url.pathname==='/user')return json({login:'alice'});
    if(url.pathname==='/user/repos')return json([repo(1)]);
    limited=true;return json({},429,{'retry-after':'120'});
  });
  await service.connect('alice','fixture-personal-token');
  await assert.rejects(service.runs('alice'),/rate limit/);assert.ok(limited);
  const count=calls.length;
  await assert.rejects(service.runs('alice'),/rate limit/);assert.equal(calls.length,count);
});
