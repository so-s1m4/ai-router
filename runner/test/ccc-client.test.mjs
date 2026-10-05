import test from 'node:test';
import assert from 'node:assert/strict';
import { cccServer, recoveringCcc, toolData, CccToolError } from '../dist/ccc-client.js';

test('CCC uses the requesting user MCP credentials without changing the runner defaults', () => {
  const name = process.env.CCC_AUTO_MCP_NAME || 'ccc';
  const owner = {url:'https://owner.example/mcp',headers:{Authorization:'owner'}};
  const friend = {name,url:'https://friend.example/mcp',headers:{Authorization:'friend'}};
  const config = {mcpServers:{[name]:owner}};
  assert.equal(cccServer(config,[friend]),friend);
  assert.equal(cccServer(config),owner);
  assert.equal(cccServer({},[friend]),friend);
  assert.equal(config.mcpServers[name],owner);
});

test('tool validation and authentication failures stop without reconnecting', async () => {
  for (const error of [new CccToolError(),new CccToolError(401),new CccToolError(422),
    Object.assign(new Error('denied'),{statusCode:403}),
    Object.assign(new Error('invalid params'),{code:-32602}),
    new Error('wrapped',{cause:Object.assign(new Error('bad input'),{code:400})})]) {
    let connects=0,retries=0;
    const client=recoveringCcc(async()=>{connects++;return {call:async()=>{throw error;},close:async()=>{}};},new AbortController().signal,()=>retries++,[0,0]);
    await assert.rejects(client.call('game_info',{}));
    assert.equal(connects,1);
    assert.equal(retries,0);
    await client.close();
  }
  assert.throws(()=>toolData({isError:true,content:[{type:'text',text:'Unauthorized https://secret.example/?token=secret'}]}),error=>error instanceof CccToolError&&!error.message.includes('secret'));
});

test('transient MCP failures retry the same read with safe diagnostics', async () => {
  const notices=[];let connects=0;
  const client=recoveringCcc(async()=>{connects++;return {close:async()=>{},call:async(name,args)=>{
    assert.equal(name,'game_info');assert.deepEqual(args,{contest:'saved'});
    if(connects===1)throw new Error('secret URL',{cause:new CccToolError(503)});
    return {ok:true};
  }};},new AbortController().signal,(...notice)=>notices.push(notice),[0]);
  assert.deepEqual(await client.call('game_info',{contest:'saved'}),{ok:true});
  assert.deepEqual(notices,[[1,'game_info','HTTP 503']]);
  await client.close();
});
