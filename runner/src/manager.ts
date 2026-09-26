import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { io } from 'socket.io-client';
import { z } from 'zod';
import { ManagementPasswordGate } from './manager-auth.js';
import { controlContainer, inspectContainer, listContainers, recreateContainer } from './manager-docker.js';
import { createKey, deleteKey, listKeys, startSshAgent, testGithub } from './manager-keys.js';

const url = process.env.ROUTER_SERVER_URL?.replace(/\/$/, '');
if (!url) throw new Error('ROUTER_SERVER_URL is required');
if (new URL(url).protocol !== 'https:' && process.env.ROUTER_ALLOW_INSECURE !== 'true') throw new Error('HTTPS required');
const gate = new ManagementPasswordGate(process.env.RUNNER_MANAGER_PASSWORD || '');
const dataRoot = process.env.MANAGER_DATA_DIR || '/manager-data';
const deviceFile = path.join(dataRoot, 'device.json');
function accountEnv(): NodeJS.ProcessEnv { return { PATH: process.env.PATH, HOME: '/home/node', RUNNER_DATA_DIR: process.env.RUNNER_DATA_DIR || '/runner-data', SSL_CERT_FILE: process.env.SSL_CERT_FILE, HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY }; }
async function runAccountHelper(op: string, payload: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(import.meta.dirname, 'manager-mcp.js')], { uid: 1000, gid: 1000, env: accountEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', finished = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 25_000);
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); if (out.length > 100_000) child.kill('SIGKILL'); });
    child.stderr.on('data', (chunk: Buffer) => { err = (err + chunk.toString()).slice(-2_000); });
    child.on('error', error => { if (!finished) { finished = true; clearTimeout(timer); reject(error); } });
    child.on('close', code => { if (finished) return; finished = true; clearTimeout(timer); if (code !== 0) return reject(new Error(err || `Настройка аккаунта завершилась: ${code}`)); try { resolve(JSON.parse(out)); } catch { reject(new Error('Неверный ответ настройки аккаунта')); } });
    child.stdin.end(JSON.stringify({ op, payload }));
  });
}
type Device = { id: string; secret: string };
async function device(): Promise<Device> {
  try { return JSON.parse(await readFile(deviceFile, 'utf8')) as Device; } catch {}
  const code = process.env.RUNNER_MANAGER_PAIRING_CODE;
  if (!code) throw new Error('Set RUNNER_MANAGER_PAIRING_CODE to enroll management');
  const response = await fetch(url + '/api/runner/manager/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  if (!response.ok) throw new Error(`Management pairing failed: ${response.status}`);
  const value = await response.json() as Device;
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  await writeFile(deviceFile, JSON.stringify(value), { mode: 0o600 });
  return value;
}

const authSessions = new Map<string, { child: ChildProcess; output: string; running: boolean; code?: number; accountId: string; createdAt: number }>();
async function startCodexLogin(accountId: string) {
  if (!/^[a-f0-9-]{36}$/.test(accountId)) throw new Error('Неверный аккаунт');
  if ([...authSessions.values()].some(session => session.accountId === accountId && session.running)) throw new Error('Вход для этого аккаунта уже запущен');
  const home = await runAccountHelper('ensureHome', { accountId }) as string;
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, CODEX_HOME: path.join(home, '.codex'), SSL_CERT_FILE: process.env.SSL_CERT_FILE, HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY };
  const child = spawn('codex', ['login', '--device-auth'], { uid: 1000, gid: 1000, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const id = randomUUID(), session = { child, output: '', running: true, code: undefined as number | undefined, accountId, createdAt: Date.now() };
  authSessions.set(id, session);
  setTimeout(() => { if (session.running) child.kill('SIGTERM'); }, 10 * 60_000).unref();
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => { session.output = (session.output + chunk.toString()).slice(-8_000); });
  child.on('error', error => { session.running = false; session.output = (session.output + '\n' + error.message).slice(-8_000); });
  child.on('close', code => { session.running = false; session.code = code ?? 1; });
  return { sessionId: id };
}
function authStatus(sessionId: string) {
  const session = authSessions.get(sessionId);
  if (!session) throw new Error('Сессия входа не найдена');
  if (!session.running && Date.now() - session.createdAt > 10 * 60_000) authSessions.delete(sessionId);
  return { sessionId, running: session.running, code: session.code, output: session.output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(-8_000), accountId: session.accountId };
}
function authCancel(sessionId: string) { const session = authSessions.get(sessionId); if (!session) throw new Error('Сессия входа не найдена'); session.child.kill('SIGTERM'); return { ok: true }; }

const uuid = z.string().uuid();
const accountInput = z.object({ accountId: uuid, provider: z.enum(['codex', 'antigravity']) });
const containerId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
const mount = z.object({ type: z.enum(['bind', 'volume']), source: z.string().min(1).max(500), target: z.string().startsWith('/').max(500), readOnly: z.boolean().optional() });
async function perform(op: string, payload: Record<string, unknown>) {
  switch (op) {
    case 'overview': {
      let containers: unknown[] = [], dockerError: string | null = null;
      try { containers = await listContainers(); } catch (error) { dockerError = error instanceof Error ? error.message : 'Docker недоступен'; }
      return { keys: await listKeys(), containers, dockerError };
    }
    case 'keys.create': return createKey(z.object({ label: z.string().min(1).max(60) }).parse(payload).label);
    case 'keys.delete': return deleteKey(z.object({ id: uuid }).parse(payload).id);
    case 'github.test': return testGithub();
    case 'containers.inspect': return inspectContainer(z.object({ id: containerId }).parse(payload).id);
    case 'containers.start': case 'containers.stop': case 'containers.restart': case 'containers.remove': return controlContainer(op.split('.')[1] as 'start' | 'stop' | 'restart' | 'remove', z.object({ id: containerId }).parse(payload).id);
    case 'containers.recreate': {
      const value = z.object({ id: containerId, image: z.string().min(1).max(300).optional(), envSet: z.record(z.string().max(4000)).optional(), envUnset: z.array(z.string()).max(50).optional(), mountsAdd: z.array(mount).max(30).optional(), mountsRemove: z.array(z.string()).max(30).optional() }).parse(payload);
      if (Object.keys(value.envSet || {}).some(key => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) throw new Error('Неверное имя переменной окружения');
      return recreateContainer(value.id, value);
    }
    case 'mcp.list': return runAccountHelper(op, accountInput.parse(payload));
    case 'mcp.add': return runAccountHelper(op, accountInput.extend({ name: z.string(), url: z.string().optional(), command: z.string().optional(), args: z.array(z.string()).max(30).optional(), env: z.record(z.string()).optional() }).parse(payload));
    case 'mcp.remove': return runAccountHelper(op, accountInput.extend({ name: z.string() }).parse(payload));
    case 'auth.start': { const value = accountInput.parse(payload); if (value.provider !== 'codex') throw new Error('Вход Google пока выполняется в терминале runner'); return startCodexLogin(value.accountId); }
    case 'auth.status': return authStatus(z.object({ sessionId: uuid }).parse(payload).sessionId);
    case 'auth.cancel': return authCancel(z.object({ sessionId: uuid }).parse(payload).sessionId);
    default: throw new Error('Операция не поддерживается');
  }
}

async function audit(op: string, payload: Record<string, unknown>, ok: boolean) {
  const target = typeof payload.id === 'string' ? payload.id : typeof payload.accountId === 'string' ? payload.accountId : undefined;
  await appendFile(path.join(dataRoot, 'audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), op, target, ok }) + '\n', { mode: 0o600 });
}

async function start() {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  await chmod(dataRoot, 0o700);
  await startSshAgent();
  const enrolled = await device();
  const socket = io(url + '/manager', { path: '/socket.io', transports: ['websocket'], auth: { runnerId: enrolled.id, secret: enrolled.secret }, reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10_000 });
  socket.on('connect', () => console.log(`Management connected for runner ${enrolled.id}`));
  socket.on('connect_error', error => console.error('Management connection failed:', error.message));
  socket.on('manage:challenge', (ack?: (value: unknown) => void) => { try { ack?.(gate.challenge()); } catch (error) { ack?.({ error: error instanceof Error ? error.message : 'Недоступно' }); } });
  socket.on('manage:action', async (raw: unknown, ack?: (value: unknown) => void) => {
    const parsed = z.object({ nonce: z.string(), proof: z.string(), op: z.string(), payload: z.record(z.unknown()) }).safeParse(raw);
    if (!parsed.success) return ack?.({ ok: false, error: 'Неверный запрос' });
    const { nonce, proof, op, payload } = parsed.data;
    if (!gate.verify(nonce, proof, op, payload)) return ack?.({ ok: false, error: 'Неверный пароль или подтверждение истекло' });
    try { const data = await perform(op, payload); await audit(op, payload, true); ack?.({ ok: true, data }); if (op === 'auth.status' && (data as any)?.running === false && (data as any)?.code === 0) socket.emit('manage:account-updated', { accountId: (data as any).accountId }); }
    catch (error) { await audit(op, payload, false).catch(() => {}); ack?.({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : 'Ошибка управления' }); }
  });
}

start().catch(error => { console.error(error); process.exit(1); });
