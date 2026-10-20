const test = require('node:test');
const assert = require('node:assert/strict');
const {computerPermissions} = require('../src/permissions.cjs');
test('permission buttons open the selected pane without waiting for native consent', async () => {
  for (const [target, pane] of [['accessibility','Privacy_Accessibility'],['screen-recording','Privacy_ScreenCapture']]) {
    const events = [];
    const result = await computerPermissions(target, {runtime:'/runtime',
      openExternal: async url => events.push(url),
      run: (file, args) => { events.push([file,args]); return {stdin:{end:()=>events.push('closed')}}; }
    });
    assert.deepEqual(result,{opened:true});
    assert.equal(events[0],'x-apple.systempreferences:com.apple.preference.security?'+pane);
    assert.deepEqual(events[1],['/runtime/computer-use',['--request-'+target]]);
    assert.equal(events[2],'closed');
  }
});
test('invalid targets cannot open URLs or start processes',async () => {
  await assert.rejects(computerPermissions('__proto__',{runtime:'/runtime',openExternal:()=>assert.fail(),run:()=>assert.fail()}),/Unknown/);
});
test('failed settings opening is surfaced',async () => {
  await assert.rejects(computerPermissions('accessibility',{runtime:'/runtime',openExternal:async()=>{throw new Error('open failed');},run:()=>assert.fail()}),/open failed/);
});
