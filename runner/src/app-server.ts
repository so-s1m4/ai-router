import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import type { Job, Event } from './cli.js';
import { RunnerError } from './cli.js';

type Json = Record<string, any>;
type Pending = { resolve: (value: Json) => void; reject: (error: Error) => void };
type NotificationHandler = (value: Json) => void;

const processes = new Map<string, AppServerConnection>();
const codexBin = process.env.CODEX_BIN || 'codex';
const taskSandbox = process.env.CODEX_TASK_SANDBOX === 'workspace-write' ? 'workspace-write' : 'danger-full-access';

function envFor(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, CODEX_HOME: `${home}/.codex` };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) delete env[key];
  return env;
}

async function commandExists(command: string) {
  const paths = command.includes('/') ? [command] : (process.env.PATH || '').split(':').map(dir => `${dir}/${command}`);
  for (const candidate of paths) try { await access(candidate, constants.X_OK); return true; } catch { /* continue */ }
  return false;
}

class AppServerConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private notifications = new Set<NotificationHandler>();
  private initialized: Promise<void>;
  private threads = new Map<string, string>();
  private closed = false;

  constructor(private readonly home: string) {
    this.child = spawn(codexBin, ['app-server', '--listen', 'stdio://', '--disable', 'apps', '--disable', 'enable_mcp_apps'], { env: envFor(home), stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', data => this.consume(data.toString()));
    this.child.stderr.on('data', () => undefined);
    this.child.on('error', error => this.fail(new RunnerError(error.message, 'unavailable')));
    this.child.on('close', code => this.fail(new RunnerError(`app-server завершился (${code ?? 1})`, 'unavailable')));
    this.initialized = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(0); this.close(); reject(new RunnerError('Инициализация App Server истекла', 'timeout')); }, Number(process.env.APP_SERVER_REQUEST_TIMEOUT_SECONDS || 30) * 1000);
      this.pending.set(0, { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.send({ method: 'initialize', id: 0, params: { clientInfo: { name: 'ai_router_runner', title: 'AI Router Runner', version: '0.2.0' } } });
    });
  }

  private send(message: Json) {
    if (this.closed || !this.child.stdin.writable) throw new RunnerError('Соединение App Server закрыто', 'unavailable');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    let index = -1;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
      let value: Json; try { value = JSON.parse(line); } catch { continue; }
      if (value.id === 0 && value.result) { try { this.send({ method: 'initialized', params: {} }); } catch { /* close handler will reject */ } }
      if (typeof value.id === 'number' && this.pending.has(value.id)) {
        const pending = this.pending.get(value.id)!; this.pending.delete(value.id);
        if (value.error) pending.reject(new RunnerError(String(value.error.message || 'App Server request failed'), 'unavailable'));
        else pending.resolve(value.result || {});
      } else if (typeof value.method === 'string') for (const handler of this.notifications) handler(value);
    }
  }

  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const handler of this.notifications) handler({ method: '__closed', params: { error: error.message } });
    if (processes.get(this.home) === this) processes.delete(this.home);
  }

  private async request(method: string, params: Json = {}) {
    await this.initialized;
    const id = this.nextId++;
    return new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new RunnerError(`${method}: время ожидания истекло`, 'timeout')); }, Number(process.env.APP_SERVER_REQUEST_TIMEOUT_SECONDS || 30) * 1000);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      try { this.send({ method, id, params }); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }

  private onNotification(handler: NotificationHandler) { this.notifications.add(handler); return () => this.notifications.delete(handler); }

  async ready() { await this.initialized; }
  close() { this.child.kill('SIGTERM'); this.fail(new RunnerError('App Server остановлен', 'unavailable')); }

  async run(job: Job, cwd: string, signal: AbortSignal, emit: (event: Event) => void, existingThreadId?: string): Promise<{ text: string; threadId: string }> {
    const cached = this.threads.get(job.taskId) || existingThreadId;
    let threadId = cached;
    if (threadId) {
      try { await this.request('thread/resume', { threadId }); }
      catch { threadId = undefined; }
    }
    if (!threadId) {
      const started = await this.request('thread/start', {
        ...(job.model !== 'default' ? { model: job.model } : {}), cwd,
        approvalPolicy: 'never', sandbox: job.mode === 'task' ? taskSandbox : 'read-only',
        serviceName: 'ai_router_runner'
      });
      threadId = String(started.thread?.id || '');
    }
    if (!threadId) throw new RunnerError('App Server не вернул thread', 'unavailable');
    this.threads.set(job.taskId, threadId);
    emit({ type: 'checkpoint', message: 'Используется сохранённый App Server thread', data: { threadId } });
    let turnId = '';
    let text = '';
    let failure = '';
    let errorInfo: Json | undefined;
    let settled = false;
    const queued: Json[] = [];
    let finish!: (error?: Error) => void;
    const completed = new Promise<void>((resolve, reject) => {
      finish = error => {
        if (settled) return;
        settled = true;
        error ? reject(error) : resolve();
      };
    });
    void completed.catch(() => undefined);
    const errorCode = (message: string, info?: Json) =>
      String(info?.codexErrorInfo?.type || info?.codexErrorInfo?.code || '').includes('UsageLimit') || /usage|quota|rate.?limit/i.test(message) ? 'rate_limit' : 'failed';
    const handle = (value: Json) => {
      const params = value.params || {};
      if (value.method === '__closed') { finish(new RunnerError(String(params.error || 'App Server закрыт'), 'unavailable')); return; }
      if (params.threadId && params.threadId !== threadId) return;
      if (!turnId) { queued.push(value); return; }
      if (params.turnId && params.turnId !== turnId) return;
      if (value.method === 'item/agentMessage/delta' && typeof (params.delta ?? params.text) === 'string') {
        const delta = String(params.delta ?? params.text); text += delta; emit({ type: 'delta', text: delta });
      } else if (value.method === 'item/started' && ['commandExecution', 'command_execution', 'fileChange', 'file_change'].includes(String(params.item?.type))) {
        emit({ type: 'tool', message: 'Инструмент', data: { type: params.item.type } });
      } else if (value.method === 'item/completed' && ['agentMessage', 'agent_message'].includes(String(params.item?.type)) && !text && typeof params.item.text === 'string') {
        text = params.item.text; emit({ type: 'delta', text });
      } else if (value.method === 'error') {
        failure = String(params.error?.message || params.message || 'Провайдер завершил запрос с ошибкой');
        errorInfo = params.error;
      } else if (value.method === 'turn/completed' && (!params.turn?.id || params.turn.id === turnId)) {
        const status = String(params.turn?.status || 'failed');
        if (status === 'completed') finish();
        else {
          failure = failure || String(params.turn?.error?.message || `turn ${status}`);
          finish(new RunnerError(failure, status === 'interrupted' && signal.aborted ? 'canceled' : errorCode(failure, params.turn?.error || errorInfo)));
        }
      }
    };
    const remove = this.onNotification(handle);
    const abort = () => {
      if (turnId) void this.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
      finish(new RunnerError('Остановлено', 'canceled'));
    };
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      if (turnId) void this.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
      finish(new RunnerError('Время ожидания App Server истекло', 'timeout'));
    }, Number(process.env.CLI_TIMEOUT_SECONDS || 180) * 1000);
    try {
      if (signal.aborted) throw new RunnerError('Остановлено', 'canceled');
      const turn = await this.request('turn/start', {
        threadId, input: [{ type: 'text', text: job.prompt }], cwd,
        approvalPolicy: 'never',
        sandboxPolicy: job.mode === 'task' ? (taskSandbox === 'workspace-write' ? { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: true } : { type: 'dangerFullAccess' }) : { type: 'readOnly', access: { type: 'fullAccess' } },
        ...(job.model !== 'default' ? { model: job.model } : {}),
        ...(job.reasoning && job.reasoning !== 'default' ? { effort: job.reasoning } : {})
      });
      turnId = String(turn.turn?.id || '');
      if (!turnId) throw new RunnerError('App Server не вернул turn', 'unavailable');
      for (const value of queued.splice(0)) handle(value);
      await completed;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      remove();
    }
    if (!text.trim()) throw new RunnerError(failure || 'CLI не вернул ответ', errorCode(failure, errorInfo));
    return { text, threadId };
  }
}

export async function runCodexAppServer(job: Job, home: string, cwd: string, signal: AbortSignal, emit: (event: Event) => void, existingThreadId?: string) {
  if (!(await commandExists(codexBin))) throw new RunnerError('CLI не установлен', 'unavailable');
  let connection = processes.get(home);
  if (!connection) { connection = new AppServerConnection(home); processes.set(home, connection); }
  return connection.run(job, cwd, signal, emit, existingThreadId);
}

export async function prewarmCodexAppServer(home: string) {
  if (!(await commandExists(codexBin))) return;
  let connection = processes.get(home);
  if (!connection) { connection = new AppServerConnection(home); processes.set(home, connection); }
  await connection.ready();
}

export function closeCodexAppServers() { for (const connection of processes.values()) connection.close(); processes.clear(); }
