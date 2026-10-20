const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createVoice, allowedVoiceSender } = require('../src/voice.cjs');

test('voice IPC accepts only the configured site main frame', () => {
  const contents = { mainFrame: { url: 'https://router.example/chats' } };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(allowedVoiceSender(event, contents, 'https://router.example'), true);
  assert.equal(allowedVoiceSender({ ...event, senderFrame: { url: 'https://router.example/chats' } }, contents, 'https://router.example'), false);
  assert.equal(allowedVoiceSender(event, {}, 'https://router.example'), false);
  assert.equal(allowedVoiceSender(event, contents, 'https://evil.example'), false);
  assert.equal(allowedVoiceSender(event, null, 'https://router.example'), false);
});
test('voice streams Russian transcription, rejects duplicate starts, stops and cleans up', () => {
  const child = new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  const signals=[];child.kill=signal=>signals.push(signal);
  const events=[];
  const voice=createVoice({executable:'/app/speech-arm64',send:event=>events.push(event),launch:(file,args)=>{assert.equal(file,'/app/speech-arm64');assert.deepEqual(args,[]);return child;}});
  voice.start();assert.throws(()=>voice.start(),/already active/);
  const text=Buffer.from(JSON.stringify({type:'result',text:'Привет мир',final:false})+'\n');
  const split=text.indexOf(Buffer.from('Привет'))+1;
  child.stdout.write(text.subarray(0,split));child.stdout.write(text.subarray(split));
  assert.equal(events[0].text,'Привет мир');
  voice.stop();assert.deepEqual(signals,['SIGTERM']);
  child.emit('close',0);assert.equal(events.at(-1).type,'end');
});
test('missing helper reports an error and releases the session', () => {
  const child = new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  const events=[];const voice=createVoice({executable:'/missing',send:e=>events.push(e),launch:()=>child});
  voice.start();child.emit('error',new Error('ENOENT'));child.emit('close',-2);
  assert.ok(events.some(e=>e.type==='error'));assert.equal(events.at(-1).type,'end');
});
