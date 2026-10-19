import { randomBytes, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { verifyRunner, setMacConnected } from './runners.js';
import { findUserById } from './auth.js';

const connected = new Map<string, Socket>();
const leases = new Map<string, {userId:string; socket:Socket; signal:AbortSignal; commands:Set<string>}>();
const command = z.object({command:z.string().min(1).max(40000),cwd:z.string().max(4000).optional()}).strict();
export function attachMacBridge(namespace:Namespace) {
  namespace.use(async (socket,next) => {
    const {runnerId,secret} = socket.handshake.auth || {};
    if (typeof runnerId !== 'string' || typeof secret !== 'string') return next(new Error('unauthorized'));
    const record = await verifyRunner(runnerId,secret);
    if (!record || !await findUserById(record.userId)) return next(new Error('unauthorized'));
    socket.data.userId = record.userId;
    next();
  });
  namespace.on('connection',async socket => {
    await setMacConnected(socket.handshake.auth.runnerId,socket);
    if (!socket.connected) return;
    const userId = socket.data.userId as string;
    connected.get(userId)?.disconnect(true);
    connected.set(userId,socket);
    socket.on('disconnect',() => { if (connected.get(userId) === socket) connected.delete(userId); });
  });
}
export function macLease(userId:string,signal:AbortSignal) {
  const socket = connected.get(userId);
  const origin = process.env.PUBLIC_URL;
  if (!socket?.connected || !origin || new URL(origin).protocol !== 'https:') return null;
  const token = randomBytes(32).toString('base64url');
  const lease = {userId,socket,signal,commands:new Set<string>()};
  leases.set(token,lease);
  const close = () => { leases.delete(token); for (const id of lease.commands) socket.emit('mac:cancel',id); };
  signal.addEventListener('abort',close,{once:true});
  return {access:{url:new URL('/api/mac/mcp',origin).href,token},close:() => { signal.removeEventListener('abort',close); close(); }};
}
export function mountMacBridge(app:Express) {
  app.all('/api/mac/mcp',async (req,res) => {
    const origin = req.get('origin');
    if (origin) { try { if (new URL(origin).host !== req.get('host')) return void res.sendStatus(403); } catch { return void res.sendStatus(403); } }
    const token = req.get('authorization')?.replace(/^Bearer /,'');
    const lease = token ? leases.get(token) : undefined;
    if (!lease || lease.signal.aborted || !lease.socket.connected || !await findUserById(lease.userId) || !await verifyRunner(lease.socket.handshake.auth.runnerId,lease.socket.handshake.auth.secret)) return void res.sendStatus(401);
    if (req.method !== 'POST') return void res.set('Allow','POST').sendStatus(405);
    const body = req.body;
    if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') return void res.sendStatus(400);
    if (body.id === undefined) return void res.sendStatus(202);
    const reply = (result:unknown) => res.json({jsonrpc:'2.0',id:body.id,result});
    if (body.method === 'initialize') return void reply({protocolVersion:['2025-03-26','2025-06-18','2025-11-25'].includes(body.params?.protocolVersion)?body.params.protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'AI Router Mac',version:'0.1.4'}});
    if (body.method === 'ping') return void reply({});
    if (body.method === 'tools/list') return void reply({tools:[{name:'mac_run_command',description:'Execute a shell command on the user’s connected Mac. Read or edit files using shell tools. cwd is a path on the Mac, defaulting to the folder the user granted. Local macOS permissions apply. Use this tool for all work requested on the Mac; server shell tools act on a different computer.',inputSchema:{type:'object',properties:{command:{type:'string'},cwd:{type:'string'}},required:['command'],additionalProperties:false}}]});
    if (body.method !== 'tools/call') return void res.json({jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}});
    const parsed = command.safeParse(body.params?.arguments);
    if (body.params?.name !== 'mac_run_command' || !parsed.success) return void res.json({jsonrpc:'2.0',id:body.id,error:{code:-32602,message:'Invalid tool arguments'}});
    const id = randomUUID();
    lease.commands.add(id);
    try {
      const result = await lease.socket.timeout(130000).emitWithAck('mac:command',{id,args:parsed.data}) as {ok:boolean;text?:string;error?:string};
      reply({content:[{type:'text',text:(result.ok?result.text:result.error)?.slice(-26000)||'Mac command failed'}],...(!result.ok?{isError:true}:{})});
    } catch { lease.socket.emit('mac:cancel',id); reply({isError:true,content:[{type:'text',text:'Mac disconnected or command timed out'}]}); }
    finally { lease.commands.delete(id); }
  });
}
