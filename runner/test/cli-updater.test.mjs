import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readlink, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CliUpdater } from '../dist/cli-updater.js';

const exec = promisify(execFile);

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cli-updater-'));
  const calls = [], logs = [], promoted = [];
  let busy = false;
  const env = {PATH:'/usr/bin',AGY_BIN:'/custom/agy'};
  const fake = async (command, args) => {
    calls.push([command,args]);
    if(command === 'codex') {
      try { await access(path.join(root,'cli/current/codex/codex')); return 'codex-cli 2.0.0'; }
      catch { return 'codex-cli 1.0.0'; }
    }
    if(command === 'npm') {
      const stage = args[args.indexOf('--prefix')+1];
      await mkdir(path.join(stage,'node_modules/.bin'),{recursive:true});
      await writeFile(path.join(stage,'node_modules/.bin/codex'),'new binary');
      return '';
    }
    return 'codex-cli 2.0.0';
  };
  const updater = new CliUpdater({root,env,busy:()=>busy,command:fake,fetch:async()=>Response.json({version:'2.0.0'}),log:message=>logs.push(message),promoted:provider=>promoted.push(provider),...options});
  return {root,env,calls,logs,promoted,updater,setBusy:value=>{busy=value;},cleanup:async()=>{updater.stop();await rm(root,{recursive:true,force:true});}};
}

test('installs latest Codex into a writable directory and atomically selects the verified binary',async()=>{
  const f=await fixture();
  try {
    await f.updater.start();
    assert.equal(await readFile(path.join(f.root,'cli/current/codex/codex'),'utf8'),'new binary');
    assert.ok((await readlink(path.join(f.root,'cli/current/codex'))).startsWith(path.join(f.root,'cli/releases')));
    assert.ok(f.env.PATH.startsWith(path.join(f.root,'cli/current/codex')));
    assert.ok(f.calls.some(([command,args])=>command==='npm'&&args.includes('@openai/codex@2.0.0')));
    assert.deepEqual(f.promoted,['codex']);
    await f.updater.check();
    assert.equal(f.calls.filter(([command])=>command==='npm').length,1);
  } finally {await f.cleanup();}
});

test('stages an update during a task but only promotes it after the runner is idle',async()=>{
  const f=await fixture();f.setBusy(true);
  try {
    await f.updater.check();
    await assert.rejects(access(path.join(f.root,'cli/current/codex')),{code:'ENOENT'});
    assert.deepEqual(f.promoted,[]);
    f.setBusy(false);await f.updater.check();
    assert.equal(await readFile(path.join(f.root,'cli/current/codex/codex'),'utf8'),'new binary');
    assert.deepEqual(f.promoted,['codex']);
  } finally {await f.cleanup();}
});

test('a failed upgrade leaves the previous CLI selected',async()=>{
  const f=await fixture();
  try {
    await f.updater.check();
    const previous=await readlink(path.join(f.root,'cli/current/codex'));
    const failed=new CliUpdater({root:f.root,env:f.env,busy:()=>false,fetch:async()=>Response.json({version:'3.0.0'}),command:async(command)=>{if(command==='codex')return 'codex-cli 2.0.0';throw new Error('offline');},log:message=>f.logs.push(message)});
    await failed.check();
    assert.equal(await readlink(path.join(f.root,'cli/current/codex')),previous);
    assert.ok(f.logs.some(message=>message.includes('keeping installed version')));
  } finally {await f.cleanup();}
});

test('concurrent checks share one download and install',async()=>{
  let finish;let downloads=0;
  const f=await fixture({fetch:()=>{downloads++;return new Promise(resolve=>{finish=resolve;});}});
  try {
    const first=f.updater.check(),second=f.updater.check();
    while(!finish)await new Promise(resolve=>setImmediate(resolve));
    finish(Response.json({version:'2.0.0'}));await Promise.all([first,second]);
    assert.equal(downloads,1);assert.equal(f.calls.filter(([command])=>command==='npm').length,1);
  } finally {await f.cleanup();}
});

test('disabled and mock runners do not contact release servers',async()=>{
  for(const env of [{CLI_AUTO_UPDATE:'false'},{MOCK_MODE:'true'}]) {
    const f=await fixture({env,fetch:async()=>{throw new Error('unexpected request');}});
    try {await f.updater.start();await f.updater.check();assert.equal(f.calls.length,0);assert.equal(f.logs.length,0);}
    finally {await f.cleanup();}
  }
});

test('Antigravity payloads are checksum verified before publication',async()=>{
  const payload=Buffer.from('fake release');
  const f=await fixture({env:{PATH:'/usr/bin',CODEX_BIN:'/custom/codex'},fetch:async url=>url.includes('/manifests/')?Response.json({version:'2.0.0',url:'https://storage.googleapis.com/antigravity-public/antigravity-cli/test/agy',sha512:createHash('sha512').update(payload).digest('hex')}):new Response(payload),command:async command=>command==='agy'?'agy 1.0.0':'agy 2.0.0'});
  try {
    await f.updater.check();
    assert.equal(await readFile(path.join(f.root,'cli/current/antigravity/agy'),'utf8'),'fake release');
    assert.deepEqual(f.promoted,['antigravity']);
    const invalid=new CliUpdater({root:f.root,env:{CODEX_BIN:'custom'},busy:()=>false,fetch:async url=>url.includes('/manifests/')?Response.json({version:'3.0.0',url:'https://storage.googleapis.com/antigravity-public/antigravity-cli/test/agy',sha512:'0'.repeat(128)}):new Response(payload),command:async()=> 'agy 2.0.0',log:message=>f.logs.push(message)});
    await invalid.check();
    assert.equal(await readFile(path.join(f.root,'cli/current/antigravity/agy'),'utf8'),'fake release');
    assert.ok(f.logs.some(message=>message.includes('checksum mismatch')));
  } finally {await f.cleanup();}
});

test('extracts and validates the Antigravity binary from the official archive layout',async()=>{
  const source=await mkdtemp(path.join(os.tmpdir(),'agy-release-'));
  let f;
  try {
    await writeFile(path.join(source,'antigravity'),'#!/bin/sh\necho "Antigravity 2.0.0"\n',{mode:0o755});
    await exec('tar',['-czf',path.join(source,'release.tar.gz'),'-C',source,'antigravity']);
    const payload=await readFile(path.join(source,'release.tar.gz'));
    f=await fixture({env:{PATH:process.env.PATH,CODEX_BIN:'/custom/codex'},fetch:async url=>url.includes('/manifests/')?Response.json({version:'2.0.0',url:'https://storage.googleapis.com/antigravity-public/antigravity-cli/test/release.tar.gz',sha512:createHash('sha512').update(payload).digest('hex')}):new Response(payload),command:async(command,args)=>command==='agy'?'Antigravity 1.0.0':(await exec(command,args)).stdout});
    await f.updater.check();
    const binary=path.join(f.root,'cli/current/antigravity/agy');
    assert.equal((await exec(binary,['--version'])).stdout.trim(),'Antigravity 2.0.0');
    await assert.rejects(access(path.join(f.root,'cli/current/antigravity/release.tar.gz')),{code:'ENOENT'});
    assert.deepEqual(f.promoted,['antigravity']);
  } finally {if(f)await f.cleanup();await rm(source,{recursive:true,force:true});}
});
