const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { createComputerTools } = require('../src/computer-tools.cjs');
const { killTree } = require('../src/process.cjs');
const path = require('node:path');
function fixture() {
  return createComputerTools({enabled:true,helper:'fixture',stopTree:killTree,spawnProcess:() => spawn(process.execPath,['-e',`
    let input=''; process.stdin.on('data',chunk=>input+=chunk);
    process.stdin.on('end',()=>{const args=JSON.parse(input);
      if(args.operation==='wait')setTimeout(()=>process.stdout.write('{}'),20000);
      else if(args.operation==='error'){process.stdout.write('{"error":"permission denied"}');process.exitCode=1;}
      else process.stdout.write(JSON.stringify(args.operation==='screenshot'?{image:'aGVsbG8=',mimeType:'image/jpeg',width:1}:{ok:true}));
    });
  `],{detached:true,stdio:['pipe','pipe','pipe']})});
}
test('computer use requires explicit local enablement',async () => {
  const tools=createComputerTools({enabled:false});
  await assert.rejects(tools.run('1',{operation:'apps'}),/disabled/);
});
test('computer helper transports screenshots and errors',async () => {
  const tools=fixture();
  try {
    const content=await tools.run('image',{operation:'screenshot'});
    assert.equal(content[1].type,'image');
    assert.equal(content[1].data,'aGVsbG8=');
    assert.deepEqual(JSON.parse(content[0].text),{width:1});
    await assert.rejects(tools.run('error',{operation:'error'}),/permission denied/);
  } finally {await tools.stop();}
});
test('stop cancels running and queued computer actions',async () => {
  const tools=fixture();
  const running=tools.run('running',{operation:'wait'});
  const queued=tools.run('queued',{operation:'apps'});
  const outcomes=Promise.allSettled([running,queued]);
  await tools.stop();
  const results=await outcomes;
  assert.ok(results.every(result=>result.status==='rejected' && /canceled/.test(result.reason.message)));
  assert.equal(JSON.parse((await tools.run('next',{operation:'apps'}))[0].text).ok,true);
});
test('native helper reports permissions without prompting', {skip:process.platform!=='darwin'}, () => {
  const helper=path.join(__dirname,'../runtime/runner/computer-use');
  const result=JSON.parse(execFileSync(helper,{input:'{"operation":"status"}',timeout:10000,encoding:'utf8'}));
  assert.equal(typeof result.accessibility,'boolean');
  assert.equal(typeof result.screen_recording,'boolean');
});
