import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cccAutoSchema, defaultCccAutoSettings } from './ccc-settings.js';

test('CCC rules reject gaps, overlaps, invalid bounds and empty races',()=>{
  assert.equal(cccAutoSchema.safeParse(defaultCccAutoSettings()).success,true);
  for(const change of [
    (s:any)=>s.levels[1].from=3,
    (s:any)=>s.levels[0].to=3,
    (s:any)=>s.levels[0].candidates.forEach((c:any)=>c.enabled=false),
    (s:any)=>s.levels[0].candidates[1].id=s.levels[0].candidates[0].id,
    (s:any)=>s.levels[0].candidates[0].delaySeconds=-1,
    (s:any)=>s.levels[0].candidates[0].accountId='../secret',
    (s:any)=>s.solutionAttempts=0,
    (s:any)=>s.endLevel=0,
    (s:any)=>s.levels.at(-1).to=100,
    (s:any)=>s.apiKey='secret',
  ]){const s=defaultCccAutoSettings();change(s);assert.equal(cccAutoSchema.safeParse(s).success,false);}
});
test('CCC settings persist atomically and stay isolated per user',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'ccc-settings-'));process.env.DATA_DIR=dir;
  try{
    const {readCccSettings,saveCccSettings}=await import('./ccc-settings-store.js');
    const s=defaultCccAutoSettings();s.submissionIntervalSeconds=2.5;s.levels[0].candidates[0].provider='openrouter';s.levels[0].candidates[0].model='anthropic/claude-test';s.levels[0].candidates[0].openRouterRouting={only:['google-ai-studio/flex'],allowFallbacks:false};
    await saveCccSettings('user-one',s);assert.deepEqual(await readCccSettings('user-one'),s);
    assert.deepEqual(await readCccSettings('user-two'),defaultCccAutoSettings());
    const next=structuredClone(s);next.solutionAttempts=4;
    await Promise.all([saveCccSettings('user-one',s),saveCccSettings('user-one',next)]);
    assert.deepEqual(await readCccSettings('user-one'),next);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('CCC routing validates endpoint slugs and remains compatible with legacy settings',()=>{
  const settings=defaultCccAutoSettings();
  assert.equal(cccAutoSchema.parse(settings).levels[0].candidates[0].openRouterRouting,undefined);
  const candidate=settings.levels[0].candidates[0];candidate.provider='openrouter';
  candidate.openRouterRouting={only:['google-ai-studio/flex'],allowFallbacks:false};
  assert.deepEqual(cccAutoSchema.parse(JSON.parse(JSON.stringify(settings))).levels[0].candidates[0].openRouterRouting,candidate.openRouterRouting);
  for(const routing of [{only:[''],allowFallbacks:false},{only:['google ai'],allowFallbacks:false},{only:['google-ai-studio/flex'],allowFallbacks:'false'},{only:Array(21).fill('google'),allowFallbacks:true}]){
    assert.equal(cccAutoSchema.safeParse({...settings,levels:[{from:1,to:null,candidates:[{...candidate,openRouterRouting:routing}]}]}).success,false);
  }
});

test('CCC accepts subscription Antigravity candidates in code and agent modes',()=>{
  for(const mode of ['code','agent'] as const){
    const settings=defaultCccAutoSettings();
    settings.levels[0].candidates[0]={...settings.levels[0].candidates[0],provider:'antigravity',model:'default',reasoning:'default',mode,fast:false};
    assert.equal(cccAutoSchema.parse(JSON.parse(JSON.stringify(settings))).levels[0].candidates[0].provider,'antigravity');
  }
});
