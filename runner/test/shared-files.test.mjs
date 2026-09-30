import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
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
  const projectId='923b2a0f-64b0-4e4d-9bf9-d5f5f3b393ea';
  const transferId='b03b7201-6e45-446a-a916-707e3c0fe3d1';
  const data=Buffer.alloc(2*1024*1024,65);
  assert.equal((await ask('file:write',{projectId,transferId,name:'.env',data})).ok,false);
  const uploaded=await ask('file:write',{projectId,transferId,name:'upload.txt',data});
  assert.equal(uploaded.ok,true);
  assert.equal(uploaded.size,data.length);
  assert.equal((await ask('file:write',{projectId,transferId,name:'upload.txt',data})).name,'upload-1.txt');
  const projectFiles=await ask('file:list',{sessionId,projectId});
  assert.equal(projectFiles.files.length,2);
  assert.equal((await ask('file:delete',{sessionId,projectId,name:'upload.txt'})).ok,true);
  assert.equal((await ask('file:list',{sessionId,projectId})).files.length,1);
  const listed=await ask('file:list',{sessionId});
  assert.deepEqual(listed.files.map(file=>file.name),['output/result.txt']);
  const info=await ask('file:info',{sessionId,name:'output/result.txt'});
  assert.equal(info.size,5);
  const chunk=await ask('file:chunk',{sessionId,name:'output/result.txt',offset:0,modified:info.modified});
  assert.equal(Buffer.from(chunk.data).toString(),'hello');
 for(const name of ['../.env','.env','.ai-router/checkpoint.json','output/shortcut']){
   assert.equal((await ask('file:info',{sessionId,name})).ok,false,name);
  }
  for(const name of ['../.env','.env','.ai-router/checkpoint.json','output/shortcut']){
   assert.equal((await ask('file:delete',{sessionId,name})).ok,false,name);
  }
  const linkedSession='a533536e-b824-4ddc-8bbc-5b2a5cc37671';
  await symlink(workspace,path.join(root,'workspaces',linkedSession));
  assert.equal((await ask('file:list',{sessionId:linkedSession})).ok,false);
  assert.equal((await ask('file:info',{sessionId:linkedSession,name:'output/result.txt'})).ok,false);

  const summaryRes = await ask('workspace:git-summary', { sessionId });
  assert.equal(summaryRes.ok, true);
  assert.equal(summaryRes.summary.isGitRepo, false);
  assert.equal(summaryRes.summary.recentFiles.length, 1);
  assert.equal(summaryRes.summary.recentFiles[0].name, 'output/result.txt');
  assert.equal((await ask('file:delete',{sessionId,name:'output/result.txt'})).ok,true);
  assert.deepEqual((await ask('file:list',{sessionId})).files,[]);
  assert.equal((await ask('file:info',{sessionId,name:'output/result.txt'})).ok,false);
  assert.equal((await ask('file:delete',{sessionId:linkedSession,name:'output/result.txt'})).ok,false);

  // Repository sources stay local; uploaded and generated code remains available.
  for(const dir of ['backend/src','frontend/src','outputs/frontend','src'])await mkdir(path.join(workspace,dir),{recursive:true});
  const sources=['backend/src/server.ts','frontend/src/app.ts','src/untracked.ts','Dockerfile','package.json','README.md','compose.prod.yaml'];
  for(const name of [...sources,'outputs/frontend/result.ts','upload.ts'])await writeFile(path.join(workspace,name),'code');
  execFileSync('git',['init','--quiet'],{cwd:workspace});
  execFileSync('git',['add','backend','frontend','README.md','compose.prod.yaml','outputs'],{cwd:workspace});
  assert.deepEqual((await ask('file:list',{sessionId})).files.map(file=>file.name).sort(),['outputs/frontend/result.ts','upload.ts']);
  for(const name of sources){
   assert.equal((await ask('file:info',{sessionId,name})).ok,false,name);
   assert.equal((await ask('file:chunk',{sessionId,name,offset:0,modified:0})).ok,false,name);
   assert.equal((await ask('file:delete',{sessionId,name})).ok,false,name);
   assert.equal(await readFile(path.join(workspace,name),'utf8'),'code');
  }
  const resultInfo=await ask('file:info',{sessionId,name:'outputs/frontend/result.ts'});
  assert.equal(resultInfo.ok,true);
  const resultChunk=await ask('file:chunk',{sessionId,name:'outputs/frontend/result.ts',offset:0,modified:resultInfo.modified});
  assert.equal(Buffer.from(resultChunk.data).toString(),'code');
  assert.equal((await ask('file:delete',{sessionId,name:'upload.ts'})).ok,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
