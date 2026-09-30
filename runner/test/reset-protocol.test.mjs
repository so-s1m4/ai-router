import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root=await mkdtemp(path.join(os.tmpdir(),'codex-reset-protocol-'));
const bin=path.join(root,'codex');
const log=path.join(root,'requests.jsonl');
await writeFile(bin,`#!/usr/bin/env node
const fs=require('node:fs');
const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const message=JSON.parse(line);if(message.id===undefined)return;
 fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(message)+'\\n');
 let result={};
 if(message.method==='account/rateLimits/read')result={rateLimits:{primary:{usedPercent:75,windowDurationMins:300,resetsAt:1800000000}},rateLimitResetCredits:{availableCount:4,credits:[{id:'bonus',status:'available',expiresAt:1800000000,title:'Bonus'}]}};
 if(message.method==='model/list')result={data:[{model:'test-model',displayName:'Test'}]};
 if(message.method==='account/rateLimitResetCredit/consume')result={outcome:'reset'};
 console.log(JSON.stringify({id:message.id,result}));
});
`,{mode:0o700});
process.env.CODEX_BIN=bin;
const {accountStatus,consumeResetCredit}=await import('../dist/cli.js');

test('Codex status requests reset details and redemption passes a stable attempt key',async()=>{
 try{
  const signal=new AbortController().signal;
  const status=await accountStatus('codex',root,signal);
  assert.equal(status.limits.primary.usedPercent,75);
  assert.equal(status.limits.resetCredits.availableCount,4);
  assert.equal(status.limits.resetCredits.credits[0].expiresAt,new Date(1800000000000).toISOString());
  const key='11111111-1111-4111-8111-111111111111';
  assert.equal(await consumeResetCredit(root,key,signal),'reset');
  assert.equal(await consumeResetCredit(root,key,signal),'reset');
  const messages=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(messages.find(m=>m.method==='account/rateLimits/read').params.excludeResetCreditDetails,false);
  const attempts=messages.filter(m=>m.method==='account/rateLimitResetCredit/consume');
  assert.deepEqual(attempts.map(m=>m.params),[{idempotencyKey:key},{idempotencyKey:key}]);
 }finally{await rm(root,{recursive:true,force:true});}
});
