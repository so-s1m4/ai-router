import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { restoreCheckpoint } from '../dist/continuation.js';
import { CheckpointWriter } from '../dist/checkpoint.js';

test('manual continuation restores original request, steering, partial output and the same-account thread',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'continuation-'));
 try{
  const writer=new CheckpointWriter(root,'source',{taskId:'source',jobId:'job',accountId:'account',sessionId:'chat',provider:'codex',model:'default',prompt:'Fix the project\nUser steering: keep API compatible'});
  writer.update({status:'failed',partialText:'Updated file A',error:'Disconnected',threadId:'thread'});await writer.flush();
  const job={taskId:'next',continuationOf:'source',sessionId:'chat',accountId:'account',prompt:'Inspect files before continuing'};
  await restoreCheckpoint(job,root);assert.equal(job.previousThreadId,'thread');assert.match(job.originalPrompt,/keep API compatible/);assert.match(job.prompt,/Updated file A/);assert.match(job.prompt,/Inspect files before continuing/);
  const other={...job,accountId:'other',previousThreadId:undefined};await restoreCheckpoint(other,root);assert.equal(other.previousThreadId,undefined);
  await assert.rejects(restoreCheckpoint({...job,sessionId:'other-chat'},root),/does not match/);
  await assert.rejects(restoreCheckpoint({...job,projectId:'other-project'},root),/does not match/);
  await assert.rejects(restoreCheckpoint({...job,continuationOf:'missing'},root),/unavailable/);
  writer.update({status:'completed'});await writer.flush();await assert.rejects(restoreCheckpoint(job,root),/already completed/);
 }finally{await rm(root,{recursive:true,force:true});}
});
