import { spawn } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

// A slow original continues untouched while one replacement is prepared/run.
// Only a completed, validated result can stop the competing work.
export async function withOptimization<T>(
  runOriginal: (signal: AbortSignal) => Promise<T>,
  optimize: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  onSlow: () => void,
  thresholdMs = 10_000,
): Promise<T> {
  signal.throwIfAborted();
  const original = new AbortController(), replacement = new AbortController();
  const originalSignal = AbortSignal.any([signal, original.signal]);
  const replacementSignal = AbortSignal.any([signal, replacement.signal]);
  let timer: NodeJS.Timeout | undefined;
  let done = false, optimizing = false, originalFailed = false, replacementFailed = false;
  let firstError: unknown;
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const result = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  const win = (value: T) => { if (!done) { done = true; resolve(value); } };
  const fail = (error: unknown, isOriginal: boolean) => {
    firstError ??= error;
    if (isOriginal) originalFailed = true; else replacementFailed = true;
    if (!done && (originalFailed && (!optimizing || replacementFailed))) { done = true; reject(firstError); }
  };
  const running = [Promise.resolve().then(() => runOriginal(originalSignal)).then(win, error => fail(error, true))];
  timer = setTimeout(() => {
    if (done || signal.aborted) return;
    optimizing = true;
    onSlow();
    running.push(Promise.resolve().then(() => optimize(replacementSignal)).then(win, error => fail(error, false)));
  }, thresholdMs);
  const abort = () => { if (!done) { done = true; reject(signal.reason || new Error('Stopped')); } };
  signal.addEventListener('abort', abort, { once: true });
  try { return await result; }
  finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
    original.abort(); replacement.abort();
    await Promise.allSettled(running);
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
