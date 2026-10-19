import { randomBytes, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { verifyRunner, setMacConnected } from './runners.js';
import { findUserById } from './auth.js';

const connected = new Map<string, Socket>();
const leases = new Map<string, {userId:string; socket:Socket; signal:AbortSignal; commands:Set<string>}>();
const command = z.object({command:z.string().min(1).max(40000),cwd:z.string().max(4000).optional()}).strict();
const computer = z.object({
  operation:z.enum(['status','apps','windows','screenshot','inspect','press','set_value','action','click','scroll','drag','key','type_text']),
  pid:z.number().int().positive().optional(),bundle_id:z.string().min(1).max(256).optional(),
  window_id:z.number().int().positive().optional(),element_id:z.string().max(1000).optional(),
  text:z.string().max(10000).optional(),action:z.enum(['AXPress','AXConfirm','AXCancel','AXIncrement','AXDecrement','AXShowMenu','AXPick']).optional(),
  x:z.number().finite().min(0).max(100000).optional(),y:z.number().finite().min(0).max(100000).optional(),
  end_x:z.number().finite().min(0).max(100000).optional(),end_y:z.number().finite().min(0).max(100000).optional(),
  delta_y:z.number().int().min(-10000).max(10000).optional(),key_code:z.number().int().min(0).max(127).optional(),
  modifiers:z.array(z.enum(['command','shift','option','control'])).max(4).optional()
}).strict().superRefine((args,ctx) => {
  if (!['status','apps'].includes(args.operation) && (!args.pid || !args.bundle_id)) ctx.addIssue({code:'custom',message:'Target pid and bundle_id required'});
});
const computerTool = {
  name:'mac_computer',
  description:'Control apps on the connected Mac in the background. Start with status, apps, then inspect (Accessibility tree) or windows and screenshot. Target pid AND bundle_id from apps. Prefer press, set_value and action with element_id from a fresh inspect. Screenshot captures only window_id owned by target app and returns an image. click/scroll/drag use window-relative POINTS from windows, not screenshot pixels; key uses macOS virtual key_code and modifiers; type_text sends Unicode. Event input is experimental, app-dependent and paused for the foreground app. Never activate apps or use global mouse/keyboard as a fallback. After every action inspect or screenshot to verify; stop on unsupported behavior. macOS permissions must be granted locally.',
  inputSchema:{type:'object',properties:{
    operation:{type:'string',enum:['status','apps','windows','screenshot','inspect','press','set_value','action','click','scroll','drag','key','type_text']},
    pid:{type:'integer'},bundle_id:{type:'string'},window_id:{type:'integer'},element_id:{type:'string'},
    text:{type:'string'},action:{type:'string',enum:['AXPress','AXConfirm','AXCancel','AXIncrement','AXDecrement','AXShowMenu','AXPick']},
    x:{type:'number'},y:{type:'number'},end_x:{type:'number'},end_y:{type:'number'},
    delta_y:{type:'integer'},key_code:{type:'integer'},modifiers:{type:'array',items:{type:'string',enum:['command','shift','option','control']}}
  },required:['operation'],additionalProperties:false}
};
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
    if (body.method === 'tools/list') return void reply({tools:[{name:'mac_run_command',description:'Execute a shell command on the user’s connected Mac. Read or edit files using shell tools. cwd is a path on the Mac, defaulting to the folder the user granted. Local macOS permissions apply. Use this tool for all work requested on the Mac; server shell tools act on a different computer.',inputSchema:{type:'object',properties:{command:{type:'string'},cwd:{type:'string'}},required:['command'],additionalProperties:false}},...(lease.socket.handshake.auth.computerUse === true ? [computerTool] : [])]});
    if (body.method !== 'tools/call') return void res.json({jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}});
    const isComputer = body.params?.name === 'mac_computer' && lease.socket.handshake.auth.computerUse === true;
    const parsed = (isComputer ? computer : command).safeParse(body.params?.arguments);
    if ((!isComputer && body.params?.name !== 'mac_run_command') || !parsed.success) return void res.json({jsonrpc:'2.0',id:body.id,error:{code:-32602,message:'Invalid tool arguments'}});
    const id = randomUUID();
    lease.commands.add(id);
    try {
      const result = await lease.socket.timeout(130000).emitWithAck(isComputer ? 'mac:computer' : 'mac:command',{id,args:parsed.data}) as {ok:boolean;text?:string;error?:string;content?:unknown};
      if (isComputer && result.ok) {
        const content = z.array(z.union([
          z.object({type:z.literal('text'),text:z.string().max(250000)}).strict(),
          z.object({type:z.literal('image'),data:z.string().max(2800000).regex(/^[A-Za-z0-9+/]*={0,2}$/),mimeType:z.literal('image/jpeg')}).strict()
        ])).min(1).max(2).safeParse(result.content);
        if (!content.success) throw new Error('Invalid computer result');
        return void reply({content:content.data});
      }
      reply({content:[{type:'text',text:(result.ok?result.text:result.error)?.slice(-26000)||'Mac command failed'}],...(!result.ok?{isError:true}:{})});
    } catch { lease.socket.emit('mac:cancel',id); reply({isError:true,content:[{type:'text',text:'Mac disconnected or command timed out'}]}); }
    finally { lease.commands.delete(id); }
  });
}
