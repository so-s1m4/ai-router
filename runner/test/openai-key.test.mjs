import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apiTextModels, fetchApiModels, readApiKey, saveApiKey } from '../dist/openai-key.js';
import { accountStatus } from '../dist/cli.js';

test('API catalog discovers future text models without a fixed version list',()=>{
  const models=apiTextModels([{id:'gpt-99-sol'},{id:'gpt-99-sol'},{id:'gpt-4o'},{id:'gpt-4o-realtime-preview'},{id:'text-embedding-3-large'},{id:'gpt-image-1'},{id:'gpt-3.5-turbo'},{id:'o3'},{id:'gpt-4'}]);
  assert.deepEqual(new Set(models.map(m=>m.id)),new Set(['gpt-99-sol','gpt-4o','o3']));
});

test('keys are isolated, permission restricted, validated before replacement, and errors omit secrets',async(t)=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'api-key-test-'));
  const key='sk-test-not-a-real-key-123456789';
  try{
    assert.equal(await readApiKey(home),undefined);
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      assert.equal(url,'https://api.openai.com/v1/models');
      assert.equal(options.headers.Authorization,`Bearer ${key}`);
      return Response.json({data:[{id:'gpt-99-sol'}]});
    });
    await saveApiKey(home,key);
    assert.equal(await readApiKey(home),key);
    assert.equal((await stat(path.join(home,'.codex/auth.json'))).mode&0o777,0o600);
    assert.deepEqual((await accountStatus('codex',home,new AbortController().signal)).models,[{id:'gpt-99-sol',label:'gpt-99-sol'}]);
    globalThis.fetch=async()=>new Response(`Invalid API key ${key}`,{status:401});
    await assert.rejects(saveApiKey(home,'sk-invalid-key-123456789'),error=>!error.message.includes(key)&&/неверный/.test(error.message));
    assert.equal(await readApiKey(home),key);
    assert.equal((JSON.parse(await readFile(path.join(home,'.codex/auth.json'),'utf8'))).auth_mode,'apikey');
    await assert.rejects(fetchApiModels(key),/неверный/);
  }finally{await rm(home,{recursive:true,force:true});}
});
