// Run on a Mac with Accessibility and Screen Recording granted: node scripts/verify-background.mjs
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {execFileSync, spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const desktop=fileURLToPath(new URL('..',import.meta.url));
const helper=process.env.DESKTOP_COMPUTER_HELPER || path.join(desktop,'runtime/runner/computer-use');
const temp=await mkdtemp(path.join(os.tmpdir(),'ai-router-background-'));
const bundle=path.join(temp,'Background Test.app/Contents');
await mkdir(path.join(bundle,'MacOS'),{recursive:true});
const binary=path.join(bundle,'MacOS/background-test');
await writeFile(path.join(bundle,'Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.airouter.background-test</string><key>CFBundleExecutable</key><string>background-test</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`);
let child;
function call(args) {
  const result=JSON.parse(execFileSync(helper,[],{input:JSON.stringify(args),encoding:'utf8',timeout:15000}));
  assert.equal(result.error,undefined); return result;
}
const front=()=>call({operation:'apps'}).apps.find(app=>app.frontmost)?.pid;
try {
  execFileSync('xcrun',['swiftc',path.join(desktop,'scripts/fixtures/background-app.swift'),'-o',binary],{stdio:'inherit'});
  const before=front();
  child=spawn(binary,[],{stdio:'ignore'});
  const target={pid:child.pid,bundle_id:'com.airouter.background-test'};
  const act=(operation,args={})=>call({...target,operation,...args});
  let tree;
  for(let attempt=0;attempt<30;attempt++) {
    await new Promise(resolve=>setTimeout(resolve,100));
    try { tree=act('inspect'); } catch(error) { if(child.exitCode !== null || attempt === 29) throw error; continue; }
    if(tree.elements.some(node=>node.title==='Verify background'))break;
  }
  assert.equal(front(),before);
  assert.equal(tree.truncated,true);
  const field=tree.elements.find(node=>node.role==='AXTextField');
  const button=tree.elements.find(node=>node.title==='Verify background');
  assert.ok(field); assert.ok(button);
  act('set_value',{element_id:field.element_id,text:'background-ok'});assert.equal(front(),before);
  act('focus',{element_id:field.element_id});assert.equal(front(),before);
  act('press',{element_id:button.element_id});assert.equal(front(),before);
  assert.ok(act('inspect').elements.some(node=>node.value==='pressed:background-ok'));
  assert.equal(act('inspect',{element_id:field.element_id}).elements[0].element_id,field.element_id);
  const window=act('windows').windows.find(window=>window.title==='AI Router Background Test');
  assert.ok(window);
  const screenshot=act('screenshot',{window_id:window.window_id});
  assert.equal(screenshot.mimeType,'image/jpeg');assert.ok(screenshot.image.length>100);
  assert.equal(front(),before);
  // NSEvent type and buttonNumber must both match; inspect every event and
  // ensure process-targeted mouse input never changes the active application.
  for (const [button,expected] of [[undefined,'mouse:2:0'],['right','mouse:4:1'],['middle','mouse:26:2']]) {
    act('click',{window_id:window.window_id,x:350,y:50,...(button?{button}:{})});
    assert.ok(act('inspect').elements.some(node=>node.value===expected),`Missing ${expected}`);
    assert.equal(front(),before);
  }
  act('scroll',{window_id:window.window_id,x:350,y:50,delta_y:-100});
  assert.ok(act('inspect').elements.some(node=>node.value?.startsWith('scroll:') && node.value!=='scroll:0.0'));
  assert.equal(front(),before);
  console.log('PASS: background AX, screenshot, left/right/middle clicks and wheel scrolling verified; foreground unchanged.');
} finally {
  if(child) {child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  await rm(temp,{recursive:true,force:true});
}
