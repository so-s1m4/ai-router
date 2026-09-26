import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('file exchange lists workspace output and rejects private paths and symlinks', async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ai-router-files-'));
 process.env.RUNNER_DATA_DIR=root;
 const {attachSharedFiles}=await import('../dist/shared-files.js');
 const socket=new EventEmitter();attachSharedFiles(socket);
 const sessionId='6c11d3e0-f185-4b0b-8b49-f16f80427474';
 const workspace=path.join(root,'workspaces',sessionId);
 await mkdir(path.join(workspace,'output'),{recursive:true});
 await mkdir(path.join(workspace,'.ai-router'),{recursive:true});
 await writeFile(path.join(workspace,'output','result.txt'),'hello');
 await writeFile(path.join(workspace,'.env'),'secret');
 await writeFile(path.join(workspace,'.ai-router','checkpoint.json'),'private');
 await symlink(path.join(workspace,'.env'),path.join(workspace,'output','shortcut'));
 const ask=(event,data)=>new Promise(resolve=>socket.emit(event,data,resolve));
 try{
  const listed=await ask('file:list',{sessionId});
  assert.deepEqual(listed.files.map(file=>file.name),['output/result.txt']);
  const info=await ask('file:info',{sessionId,name:'output/result.txt'});
  assert.equal(info.size,5);
  const chunk=await ask('file:chunk',{sessionId,name:'output/result.txt',offset:0,modified:info.modified});
  assert.equal(Buffer.from(chunk.data).toString(),'hello');
  for(const name of ['../.env','.env','.ai-router/checkpoint.json','output/shortcut']){
   assert.equal((await ask('file:info',{sessionId,name})).ok,false,name);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
