const fs = require('node:fs/promises');
const path = require('node:path');
const { createTools } = require('./mac-tools.cjs');
const { createComputerTools } = require('./computer-tools.cjs');
const { killTree } = require('./process.cjs');
async function main() {
  const data = process.env.RUNNER_DATA_DIR;
  const modules = process.env.MAC_BRIDGE_MODULE;
  const { io } = require(modules);
  const url = new URL(process.env.ROUTER_SERVER_URL);
  if (url.protocol !== 'https:') throw new Error('HTTPS required');
  const file = path.join(data,'device.json');
  let device;
  try { device = JSON.parse(await fs.readFile(file,'utf8')); } catch {
    const response = await fetch(url.origin+'/api/runner/enroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:process.env.ROUTER_PAIRING_CODE}),signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error('Unable to pair Mac: HTTP '+response.status);
    device = await response.json();
    await fs.writeFile(file,JSON.stringify(device),{mode:0o600});
  }
  // No server token or pairing code is inherited by commands.
  const env = {PATH:process.env.PATH,LANG:process.env.LANG,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,DESKTOP_ACCESS_MODE:process.env.DESKTOP_ACCESS_MODE};
  const tools = createTools({root:process.env.DESKTOP_ACCESS_ROOT,data,env,stopTree:killTree});
  const computer = createComputerTools({enabled:process.env.DESKTOP_COMPUTER_USE === '1' && env.DESKTOP_ACCESS_MODE === 'full',helper:path.join(process.env.MAC_COMPUTER_HELPER_ROOT,'computer-use'),stopTree:killTree});
  const socket = io(url.origin+'/mac',{transports:['websocket'],auth:{runnerId:device.id,secret:device.secret,computerUse:process.env.DESKTOP_COMPUTER_USE === '1' && env.DESKTOP_ACCESS_MODE === 'full'}});
  socket.on('connect',() => console.log(`Runner ${device.name} connected · Mac bridge`));
  socket.on('connect_error',error => console.error(error.message === 'Invalid namespace' ? 'This server does not support Mac access yet. Update the AI Router backend to a version with Mac bridge support.' : 'Mac connection failed: '+error.message));
  socket.on('disconnect',() => { void tools.stop(); void computer.stop(); console.log('Control plane disconnected'); });
  socket.on('mac:command',async (request,ack) => {
    if (typeof ack !== 'function') return;
    try { ack({ok:true,text:await tools.run(request.id,request.args)}); }
    catch(error) { ack({ok:false,error:error.message}); }
  });
  socket.on('mac:computer',async (request,ack) => {
    if (typeof ack !== 'function') return;
    try { ack({ok:true,content:await computer.run(request.id,request.args)}); }
    catch(error) { ack({ok:false,error:error.message}); }
  });
  socket.on('mac:cancel',id => { void tools.cancel(id).catch(() => {}); void computer.cancel(id).catch(() => {}); });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
