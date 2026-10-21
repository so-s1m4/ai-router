import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CccGcpVm } from '../dist/ccc-gcp-vm.js';

const settings={enabled:false,runnerId:'11111111-1111-4111-8111-111111111111',project:'test-project',zone:'europe-west3-a',instance:'ccc-compute',workers:8,timeoutSeconds:120,useIap:false};
async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'ccc-vm-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const binary=path.join(root,'gcloud');
 await writeFile(binary, `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.CLOUDSDK_CONFIG+'/calls',JSON.stringify(args)+'\\n');
if(args.includes('create')){
 const file=args.find(x=>x.startsWith('--metadata-from-file=')).split('startup-script=')[1];
 fs.writeFileSync(process.env.CLOUDSDK_CONFIG+'/startup',fs.readFileSync(file));
}
if(args.includes('list'))console.log(JSON.stringify([{name:'ccc-compute',zone:'https://example/zones/europe-west3-a',status:'RUNNING'}]));
if(args.includes('--project=denied-project')){console.error('Permission denied for project');process.exit(1);}
`,{mode:0o700});
 return {root,vm:new CccGcpVm(root,binary),calls:async()=> (await readFile(path.join(root,'calls'),'utf8')).trim().split('\n').map(JSON.parse)};
}
test('VM lifecycle uses isolated credentials, provisions tools, and reapplies stop limit on restart',async t=>{
 const f=await fixture(t);
 assert.match((await f.vm.run('status',settings)).status,/RUNNING/);
 const pending=f.vm.run('create',{...settings,machineType:'e2-standard-32'});
 await assert.rejects(f.vm.run('start',settings),/already in progress/);
 await pending;
 await f.vm.run('start',settings);
 await f.vm.run('stop',settings);
 await f.vm.run('resize',{...settings,machineType:'e2-standard-16'});
 const calls=await f.calls();
 assert.deepEqual(calls[1],['services','enable','compute.googleapis.com','--project=test-project','--quiet']);
 const create=calls.find(x=>x.includes('create'));
 for(const flag of ['--machine-type=e2-standard-32','--max-run-duration=3600s','--instance-termination-action=STOP','--no-service-account','--async'])assert.ok(create.includes(flag));
 assert.match(await readFile(path.join(f.root,'startup'),'utf8'),/nodejs python3 g\+\+ util-linux/);
 const script=create.find(x=>x.startsWith('--metadata-from-file=')).split('startup-script=')[1];
 await assert.rejects(readFile(script),{code:'ENOENT'});
 assert.ok(calls.findIndex(x=>x.includes('set-scheduling'))<calls.findIndex(x=>x.includes('start')));
 assert.ok(calls.find(x=>x.includes('stop')).includes('--async'));
 assert.ok(calls.find(x=>x.includes('set-machine-type')).includes('--machine-type=e2-standard-16'));
});
test('invalid VM identifiers never spawn gcloud; cloud errors release the request lock',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.vm.run('create',{...settings,instance:'vm;touch bad'}));
 await assert.rejects(f.vm.run('resize',{...settings,machineType:'nonsense'}));
 await assert.rejects(readFile(path.join(f.root,'calls')),{code:'ENOENT'});
 await assert.rejects(f.vm.run('status',{...settings,project:'denied-project'}),/Permission denied/);
 assert.match((await f.vm.run('status',settings)).status,/RUNNING/);
});
test('missing CLI is actionable',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ccc-vm-missing-'));
 try{await assert.rejects(new CccGcpVm(root,path.join(root,'missing')).run('status',settings),/CLI is unavailable/);}
 finally{await rm(root,{recursive:true,force:true});}
});
