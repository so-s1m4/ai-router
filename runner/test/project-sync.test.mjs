import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { exportProject, importProject } from '../dist/project-sync.js';

test('sync accepts files above 64 MiB and archive metadata above 96 MiB',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'project-sync-large-'));
 try{
  const source=path.join(root,'source'),target=path.join(root,'target');
  await mkdir(source);
  const size=73*1024*1024;
  await writeFile(path.join(source,'large.bin'),Buffer.alloc(size,0x5a));
  const archive=await exportProject(source);
  assert.ok(gunzipSync(archive).length>96*1024*1024);
  await importProject(target,archive);
  const data=await readFile(path.join(target,'large.bin'));
  assert.equal(data.length,size);
  assert.ok(data.every(byte=>byte===0x5a));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('sync accepts more than 20,000 files',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'project-sync-many-'));
 try{
  const source=path.join(root,'source'),target=path.join(root,'target');
  const entries=Array.from({length:20001},(_,i)=>({name:`file-${i}.txt`,data:'eA==',mode:0o600}));
  await importProject(source,gzipSync(JSON.stringify(entries)));
  const archive=await exportProject(source);
  assert.equal(JSON.parse(gunzipSync(archive).toString()).length,20001);
  await importProject(target,archive);
  assert.equal(await readFile(path.join(target,'file-20000.txt'),'utf8'),'x');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('sync carries source, binary artifacts, git and deletions, preserves executable permissions and local recovery copy',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'project-sync-'));
 try{
  const source=path.join(root,'source'),target=path.join(root,'target');
  for(const dir of ['src','outputs','.git','node_modules','.codex'])await mkdir(path.join(source,dir),{recursive:true});
  await mkdir(target);await writeFile(path.join(target,'deleted.txt'),'stale');await writeFile(path.join(target,'.env.local'),'LOCAL');await mkdir(path.join(target,'node_modules'));await writeFile(path.join(target,'node_modules/local.js'),'local dependency');
  await writeFile(path.join(source,'src/main.ts'),'console.log("shared")');
  await writeFile(path.join(source,'outputs/data.bin'),Buffer.from([0,1,255]));
  await writeFile(path.join(source,'.git/HEAD'),'ref: refs/heads/main');
  await writeFile(path.join(source,'run.sh'),'#!/bin/sh\n');await chmod(path.join(source,'run.sh'),0o755);
  for(const file of ['.env','.env.production','.codex/auth.json','node_modules/unused.js'])await writeFile(path.join(source,file),'PRIVATE');
  await importProject(target,await exportProject(source));
  assert.equal(await readFile(path.join(target,'src/main.ts'),'utf8'),'console.log("shared")');
  assert.deepEqual(await readFile(path.join(target,'outputs/data.bin')),Buffer.from([0,1,255]));
  assert.equal((await stat(path.join(target,'run.sh'))).mode&0o777,0o755);
  assert.equal(await readFile(path.join(target,'.git/HEAD'),'utf8'),'ref: refs/heads/main');
  for(const file of ['deleted.txt','.env','.env.production','.codex/auth.json','node_modules/unused.js'])await assert.rejects(readFile(path.join(target,file)),{code:'ENOENT'});
  assert.equal(await readFile(target+'-previous/deleted.txt','utf8'),'stale');
  assert.equal(await readFile(path.join(target,'.env.local'),'utf8'),'LOCAL');
  assert.equal(await readFile(path.join(target,'node_modules/local.js'),'utf8'),'local dependency');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('bad archive paths, duplicates, symlinks and incomplete data never replace the current workspace',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'project-sync-invalid-'));
 try{
  const target=path.join(root,'target');await mkdir(target);await writeFile(path.join(target,'kept.txt'),'safe');
  for(const name of ['../escape','/absolute','src/../../escape','a\\b','.env','.codex/auth.json']){
   await assert.rejects(importProject(target,gzipSync(JSON.stringify([{name,data:'eA==',mode:0o600}]))));
   assert.equal(await readFile(path.join(target,'kept.txt'),'utf8'),'safe');
  }
  await assert.rejects(importProject(target,Buffer.from('corrupt')));
  await assert.rejects(importProject(target,gzipSync(JSON.stringify([{name:'a',data:'eA==',mode:0o600},{name:'a',data:'eA==',mode:0o600}]))));
  await symlink('/etc/passwd',path.join(target,'link'));await assert.rejects(exportProject(target),/symbolic links/);
  assert.equal(await readFile(path.join(target,'kept.txt'),'utf8'),'safe');
 }finally{await rm(root,{recursive:true,force:true});}
});
