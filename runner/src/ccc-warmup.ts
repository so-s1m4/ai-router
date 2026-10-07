import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { connectCcc, type CccClient } from './ccc-client.js';
import { contestReference } from './ccc-auto.js';
import type { Event, Job } from './cli.js';

const ttl = 10 * 60_000;
const warmed = new Map<string, { client: CccClient; controller: AbortController; timer: NodeJS.Timeout }>();
type Solver = (job: Job, signal: AbortSignal, emit: (event: Event) => void) => Promise<string>;

export function isCccPreparation(prompt: string): boolean {
  const current = prompt.split('Current user request:\n').at(-1)!.trim();
  if (/^(?:ready|warmup|prepare|прогрей|прогрев|подготовь)(?:\s|$)/i.test(current)) return true;
  try { contestReference(current); return false; }
  catch { return !/https?:\/\//i.test(current); }
}

async function warmKey(job: Job) {
  const root = process.env.RUNNER_DATA_DIR || '/runner-data';
  const config = await readFile(path.join(root, 'global-mcp/.gemini/config/mcp_config.json'), 'utf8').catch(() => '');
  return createHash('sha256').update(JSON.stringify([job.sessionId, job.projectId, job.cccAuto ? undefined : job.accountId, job.cccAuto, job.personalMcp, config])).digest('hex');
}

function command(binary: string, args: string[], cwd: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { cwd, signal, timeout: 30_000, maxBuffer: 8192 }, error => {
      if (error) reject(new Error(`CCC прогрев: ${path.basename(binary)} failed`, { cause: error }));
      else resolve();
    });
  });
}

export async function warmRuntimes(cwd: string, signal: AbortSignal) {
  const dir = path.join(cwd, '.ai-router/ccc-warmup', randomUUID());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(dir, 'probe.cpp'), '#include <iostream>\nint main(){std::cout<<"ready";}', { mode: 0o600 });
  const checks = await Promise.allSettled([
    (async () => {
      await command('g++', ['-std=c++17', '-O2', '-pipe', 'probe.cpp', '-o', 'probe'], dir, signal);
      await command(path.join(dir, 'probe'), [], dir, signal);
    })(),
    command('python3', ['-c', 'import json, pathlib, sys; print("ready")'], dir, signal),
    command(process.execPath, ['-e', 'require("node:fs"); require("node:child_process"); console.log("ready")'], dir, signal),
  ]);
  await rm(dir, { recursive: true, force: true });
  signal.throwIfAborted();
  for (const check of checks) if (check.status === 'rejected') throw check.reason;
}

export async function prepareCcc(job: Job, cwd: string, solve: Solver, signal: AbortSignal, emit: (event: Event) => void,
  options: { connect?: typeof connectCcc; runtimes?: typeof warmRuntimes } = {}) {
  const key = await warmKey(job);
  if (warmed.has(key)) { signal.throwIfAborted(); return; }
  const controller = new AbortController();
  const stop = () => controller.abort(signal.reason);
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  const client = await (options.connect || connectCcc)(controller.signal, undefined, job.personalMcp);
  const usage = new Map<string, { accountId: string; provider: string; model: string; usage: Record<string, number> }>();
  try {
    emit({ type: 'status', message: 'CCC прогрев: MCP, C++17, Python, Node.js и модели' });
    const models = job.cccAuto?.levels.flatMap(rule => rule.candidates.filter(c => c.enabled)) ??
      [{ accountId: job.accountId, provider: job.provider, model: 'gpt-6.1-sol', reasoning: 'low', fast: true, openRouterRouting: undefined }];
    // One real inference per connection/model/routing warms all candidates using it.
    const unique = [...new Map(models.map(c => [JSON.stringify([c.accountId, c.provider, c.model, c.openRouterRouting]), c])).values()];
    const probes = async () => {
      for (const candidate of unique) {
        controller.signal.throwIfAborted();
        const accountId = candidate.accountId || job.accountId;
        emit({ type: 'status', message: `CCC прогрев: ${candidate.provider} / ${candidate.model}` });
        const id = randomUUID();
        const response = await solve({ ...job, jobId: id, taskId: id, workflow: 'standard', cccAuto: undefined,
          provider: candidate.provider, accountId, model: candidate.model, reasoning: candidate.reasoning,
          openRouterRouting: candidate.openRouterRouting, fast: candidate.fast, solverOnly: true, solverCodeOnly: true,
          previousThreadId: undefined, personalMcp: candidate.provider === 'codex' ? job.personalMcp : [],
          prompt: 'Connection readiness check. No tools. Return exactly {"source":"ready","outputMode":"exact"}.', mode: 'task',
        }, AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]), event => {
          if (event.type !== 'usage' || !event.data || event.data.limits) return;
          const latest: Record<string, number> = {};
          for (const [field, snake] of [['inputTokens','input_tokens'],['outputTokens','output_tokens'],['totalTokens','total_tokens'],['cachedInputTokens','cached_input_tokens'],['reasoningOutputTokens','reasoning_output_tokens']]) {
            const value = event.data[field] ?? event.data[snake];
            if (typeof value === 'number') latest[field] = value;
          }
          latest.totalTokens ??= (latest.inputTokens || 0) + (latest.outputTokens || 0);
          usage.set(id, { accountId, provider: candidate.provider, model: candidate.model, usage: latest });
          const total: Record<string, number> = {};
          const groups = new Map<string, typeof usage extends Map<string, infer V> ? V : never>();
          for (const row of usage.values()) for (const [field, value] of Object.entries(row.usage)) total[field] = (total[field] || 0) + value;
          for (const row of usage.values()) {
            const key = `${row.accountId}:${row.provider}:${row.model}`;
            const group = groups.get(key) ?? { ...row, usage: {} };
            for (const [field, value] of Object.entries(row.usage)) group.usage[field] = (group.usage[field] || 0) + value;
            groups.set(key, group);
          }
          emit({ type: 'usage', data: { ...total, cccUsage: [...groups.values()] } });
        });
        if (JSON.parse(response).source !== 'ready') throw new Error(`CCC прогрев: ${candidate.provider} / ${candidate.model} did not confirm readiness`);
      }
    };
    const results = await Promise.allSettled([client.ready!(), (options.runtimes || warmRuntimes)(cwd, controller.signal), probes()]);
    controller.signal.throwIfAborted();
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    // Bound idle connections and close them without polling while waiting for a link.
    if (warmed.size >= 32) {
      const oldest = warmed.keys().next().value!;
      const entry = warmed.get(oldest)!;
      warmed.delete(oldest); clearTimeout(entry.timer); entry.controller.abort(); void entry.client.close().catch(() => {});
    }
    const timer = setTimeout(() => {
      warmed.delete(key); controller.abort(); void client.close().catch(() => {});
    }, ttl);
    timer.unref();
    warmed.set(key, { client, controller, timer });
  } catch (error) {
    controller.abort(); await client.close().catch(() => {}); throw error;
  } finally { signal.removeEventListener('abort', stop); }
}

export async function takeWarmCcc(job: Job, signal: AbortSignal): Promise<CccClient | undefined> {
  signal.throwIfAborted();
  const key = await warmKey(job), entry = warmed.get(key);
  if (!entry) return;
  warmed.delete(key); clearTimeout(entry.timer);
  const stop = () => entry.controller.abort(signal.reason);
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  return { call: (name, args) => entry.client.call(name, args), async close() {
    signal.removeEventListener('abort', stop); entry.controller.abort(); await entry.client.close();
  } };
}
