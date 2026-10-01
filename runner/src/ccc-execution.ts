import { spawn } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

// Optimization starts only after the original has exceeded its execution limit
// and exited. There is no competing AI call or cancellation to await on success.
export async function withOptimization<T>(
  runOriginal: (signal: AbortSignal) => Promise<T>,
  optimize: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  onSlow: () => void,
  limitMs = executionLimitMs,
): Promise<T> {
  try { return await withExecutionLimit(runOriginal, signal, limitMs); }
  catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof ExecutionLimitError)) throw error;
    onSlow();
    return optimize(signal);
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
  await new Promise<void>((resolve, reject) => {
    let log = '', canceled = false;
    const child = spawn(binary, [script, taskFile, answersFile], {
      cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', PYTHONUNBUFFERED: '1' },
    });
    const append = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-64000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      canceled = true;
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      killTimer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 1000);
      killTimer.unref();
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const cleanup = () => { signal.removeEventListener('abort', stop); if (!canceled) clearTimeout(killTimer); };
    child.on('error', error => { cleanup(); reject(new Error(`Unable to start CCC solver (${recipe.runtime}): ${error.message}`)); });
    child.on('close', async code => {
      cleanup();
      try {
        await writeFile(path.join(directory, 'execution.log'), log, { mode: 0o600 });
        if (canceled) reject(signal.reason || new Error('Stopped'));
        else if (code !== 0) reject(new Error(`CCC solver exited with code ${code}; see ${path.join(directory, 'execution.log')}`));
        else resolve();
      } catch (error) { reject(error); }
    });
  });
}
