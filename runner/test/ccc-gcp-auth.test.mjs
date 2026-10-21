import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CccGcpAuth } from '../dist/ccc-gcp-auth.js';

test('Google sign-in retains its process, isolates credentials, completes and revokes', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'ccc-auth-test-'));
  const binary=path.join(root,'gcloud');
  await writeFile(binary, `#!/usr/bin/env node
const fs=require('node:fs');
const state=process.env.CLOUDSDK_CONFIG+'/account';
const action=process.argv[3];
if(action==='list') { if(fs.existsSync(state))console.log(fs.readFileSync(state,'utf8')); }
else if(action==='revoke') { fs.rmSync(state,{force:true}); }
else if(action==='login') {
 process.stderr.write('Go to the following link in your browser:\\nhttps://accounts.google.com/o/oauth2/auth?state=example&code_challenge=pkce\\n');
 setTimeout(()=>process.stderr.write('Enter verification code: '),15);
 process.stdin.once('data',code=>{if(code.toString().trim()==='valid-code'){fs.writeFileSync(state,'user@example.com');process.exit(0);}else{console.error('SECRET_DO_NOT_EXPOSE');process.exit(1);}});
}
`,{mode:0o700});
  const auth=new CccGcpAuth(path.join(root,'config'),binary);
  try {
    assert.deepEqual(await auth.status(),{connected:false,email:undefined});
    const starting=auth.start();auth.cancel();
    await assert.rejects(starting,/canceled/);
    const first=await auth.start();
    assert.match(first.url,/^https:\/\/accounts.google.com\//);
    assert.ok(first.expiresAt>Date.now());
    await assert.rejects(auth.complete('wrong-flow','valid-code'),/expired/);
    const next=await auth.start();
    await assert.rejects(auth.complete(first.flowId,'valid-code'),/expired/);
    assert.deepEqual(await auth.complete(next.flowId,'valid-code'),{connected:true,email:'user@example.com'});
    assert.deepEqual(await auth.status(),{connected:true,email:'user@example.com'});
    const other=new CccGcpAuth(path.join(root,'other-config'),binary);
    assert.equal((await other.status()).connected,false);
    const failed=await auth.start();
    await assert.rejects(auth.complete(failed.flowId,'bad-code'),error=>!error.message.includes('SECRET')&&/failed/.test(error.message));
    const canceled=await auth.start();auth.cancel();
    await assert.rejects(auth.complete(canceled.flowId,'valid-code'),/expired/);
    assert.deepEqual(await auth.disconnect(),{connected:false});
    assert.equal((await auth.status()).connected,false);
  } finally {auth.cancel();await rm(root,{recursive:true,force:true});}
});

test('Missing Google CLI produces an actionable error',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'ccc-auth-missing-'));
  const auth=new CccGcpAuth(root,path.join(root,'missing-gcloud'));
  try {await assert.rejects(auth.start(),/CLI is unavailable/);await assert.rejects(auth.status(),/CLI is unavailable/);}
  finally{auth.cancel();await rm(root,{recursive:true,force:true});}
});
