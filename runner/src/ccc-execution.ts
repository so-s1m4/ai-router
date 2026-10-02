import { availableParallelism, freemem } from 'node:os';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Shared across racing candidates: bound native processes by CPU and memory.
const cppMemoryBytes = 512 * 1024 * 1024;
function workerBudget() {
  let memory = freemem();
  let cpus = availableParallelism();
  try {
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/).map(Number);
    if (Number.isFinite(quota) && period > 0) cpus = Math.min(cpus, Math.max(1, Math.floor(quota / period)));
  } catch {}
  try {
    const limit = Number(readFileSync('/sys/fs/cgroup/memory.max', 'utf8'));
    const used = Number(readFileSync('/sys/fs/cgroup/memory.current', 'utf8'));
    if (Number.isFinite(limit)) memory = Math.min(memory, Math.max(0, limit - used));
  } catch {}
  return Math.max(1, Math.min(4, cpus, Math.floor(memory / (cppMemoryBytes * 1.25))));
}
let cppWorkers = 0;
const workerWaiters = new Set<() => void>();
async function reserveWorkers(signal: AbortSignal) {
  while (cppWorkers >= workerBudget()) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { workerWaiters.delete(ready); signal.removeEventListener('abort', abort); };
      const ready = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(signal.reason); };
      workerWaiters.add(ready);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  signal.throwIfAborted();
  // Leave CPU capacity for a competing solver on small runners.
  const count = Math.max(1, Math.min(2, Math.ceil(workerBudget() / 2), workerBudget() - cppWorkers));
  cppWorkers += count;
  return { count, release: () => { cppWorkers -= count; for (const ready of [...workerWaiters]) ready(); } };
}

export const executionLimitMs = 120_000;
export class ExecutionLimitError extends Error {
  constructor(limitMs: number) { super(`CCC computation exceeded ${limitMs / 1000} seconds`); }
}

export async function withExecutionLimit<T>(
  run: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, limitMs = executionLimitMs,
): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const timeout = new ExecutionLimitError(limitMs);
  const timer = setTimeout(() => controller.abort(timeout), limitMs);
  try {
    const value = await run(AbortSignal.any([signal, controller.signal]));
    signal.throwIfAborted();
    controller.signal.throwIfAborted();
    return value;
  } catch (error) {
    signal.throwIfAborted();
    if (controller.signal.aborted) throw timeout;
    throw error;
  } finally { clearTimeout(timer); }
}

export const optimizationDelayMs = 10_000;

// Keep the original alive while preparing and running a faster candidate.
// A failed optimizer must not discard a still-running original.
export async function withOptimization<T>(
  runOriginal: (signal: AbortSignal) => Promise<T>,
  optimize: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  onSlow: () => void,
  delayMs = optimizationDelayMs,
): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const candidateSignal = AbortSignal.any([signal, controller.signal]);
  let timer: NodeJS.Timeout | undefined;
  let abort: () => void = () => {};
  const result = new Promise<T>((resolve, reject) => {
    let started = false, failed = 0, originalError: unknown;
    const failure = (error: unknown, original: boolean) => {
      if (original) originalError = error;
      if (!started || ++failed === 2) reject(originalError ?? error);
    };
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      if (candidateSignal.aborted) return;
      started = true;
      try { onSlow(); } catch (error) { reject(error); return; }
      Promise.resolve().then(() => optimize(candidateSignal)).then(resolve, error => failure(error, false));
    }, delayMs);
    Promise.resolve().then(() => runOriginal(candidateSignal)).then(resolve, error => failure(error, true));
    if (signal.aborted) abort();
  });
  try { return await result; }
  finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.abort(new Error('CCC execution race finished'));
  }
}

// Recipe commands have fixed arguments and no shell interpretation. Each
// candidate has its own source, output manifest and working directory.
export async function runRecipe(directory: string, taskFile: string, answersFile: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const recipeBytes = await readFile(path.join(directory, 'solver.json'));
  if (recipeBytes.length > 16000) throw new Error('CCC solver recipe is too large');
  const recipe = JSON.parse(recipeBytes.toString('utf8'));
  if (!['node', 'python3'].includes(recipe.runtime) || typeof recipe.script !== 'string') throw new Error('CCC solver recipe requires runtime node or python3 and a local script');
  const root = await realpath(directory), script = await realpath(path.resolve(directory, recipe.script));
  if (!script.startsWith(root + path.sep)) throw new Error('CCC solver source must stay inside its candidate folder');
  const binary = recipe.runtime === 'node' ? process.execPath : 'python3';
  const workers = recipe.runtime === 'node' && path.basename(script) === 'cpp.cjs' ? await reserveWorkers(signal) : undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let log = '', canceled = false;
      const child = spawn(binary, [script, taskFile, answersFile], {
        cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, LANG: 'C.UTF-8', PYTHONUNBUFFERED: '1', CCC_CPP_WORKERS: String(workers?.count ?? 1), CCC_CPP_MEMORY_BYTES: String(cppMemoryBytes) },
      });
      const append = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-64000); };
      child.stdout.on('data', append); child.stderr.on('data', append);
      const stop = () => {
        canceled = true;
        if (!child.pid) return;
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      };
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
      const cleanup = () => { signal.removeEventListener('abort', stop); };
      child.on('error', error => { cleanup(); reject(new Error(`Unable to start CCC solver (${recipe.runtime}): ${error.message}`)); });
      child.on('close', async code => {
        cleanup();
        try {
          await writeFile(path.join(directory, 'execution.log'), log, { mode: 0o600 });
          if (canceled) reject(signal.reason || new Error('Stopped'));
          else if (code !== 0) reject(new Error(`CCC solver exited with code ${code}: ${log.slice(-8000)}; see ${path.join(directory, 'execution.log')}`));
          else resolve();
        } catch (error) { reject(error); }
      });
    });
  } finally { workers?.release(); }
}
