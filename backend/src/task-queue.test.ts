import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskQueue } from './task-queue.js';
import { UsageLedger } from './usage-summary.js';
import { AccountUsageManager } from './usage.js';

test('queue persists priorities and cancellation; running tasks require review after restart',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'queue-test-'));
 try{const file=path.join(root,'queue.json'),q=new TaskQueue(file);await q.load();const now=new Date().toISOString();for(const id of ['waiting','running','canceled'])await q.add({id,userId:'a',input:{prompt:id},state:'queued',priority:1,message:'Waiting',createdAt:now,updatedAt:now});await q.update('waiting',{priority:2});await q.update('running',{state:'running'});await q.update('canceled',{state:'canceled'});const reload=new TaskQueue(file);await reload.load();assert.equal(reload.list('b').length,0);assert.equal(reload.list('a')[0].id,'waiting');assert.equal(reload.list('a').find(t=>t.id==='running')?.state,'error');assert.equal(reload.list('a').find(t=>t.id==='canceled')?.state,'canceled');}finally{await rm(root,{recursive:true,force:true});}
});
test('usage ledger preserves failed and handed-off work, replaces duplicate snapshots and isolates users',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ledger-test-'));
 try{const file=path.join(root,'ledger.json'),ledger=new UsageLedger(file);await ledger.load();const row={userId:'a',runId:'run',accountId:'one',model:'model',provider:'codex',tokens:{totalTokens:10}};await ledger.record(row);await ledger.record({...row,tokens:{totalTokens:20}});await ledger.record({...row,accountId:'two',tokens:{totalTokens:30}});const reload=new UsageLedger(file);await reload.load();assert.equal(reload.summary('a',[]).totalTokens,50);assert.equal(reload.summary('b',[]).totalTokens,0);assert.equal(reload.summary('a',[{id:'chat',title:'Chat',createdAt:'',updatedAt:'',messages:[{id:'msg',runId:'run',role:'assistant',text:'Answer',at:'',tokenUsage:{totalTokens:50}}]}]).totalTokens,50);}finally{await rm(root,{recursive:true,force:true});}
});
test('exhausted provider windows wait until reset',()=>{const usage=new AccountUsageManager();usage.update('u','a',{primary:{usedPercent:100,resetAt:new Date(Date.now()+60000).toISOString()}});assert.equal(usage.available('u','a'),false);usage.update('u','a',{primary:{usedPercent:100,resetAt:new Date(Date.now()-1000).toISOString()}});assert.equal(usage.available('u','a'),true);});
