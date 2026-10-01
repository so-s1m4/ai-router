export const lightHeadStartMs = 20_000;

// Race complete, locally checked candidates. A failed candidate cannot win.
export async function raceLight<T>(
  light: (signal: AbortSignal) => Promise<T>,
  backups: ((signal: AbortSignal) => Promise<T>)[],
  signal: AbortSignal,
  onSlow: () => void,
  headStartMs = lightHeadStartMs,
): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const candidateSignal = AbortSignal.any([signal, controller.signal]);
  const tasks: Promise<void>[] = [];
  let expanded = false, settled = false, remaining = 1;
  const errors: unknown[] = [];
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  const start = (run: (signal: AbortSignal) => Promise<T>) => {
    tasks.push(Promise.resolve().then(() => run(candidateSignal)).then(value => {
      candidateSignal.throwIfAborted();
      if (!settled) { settled = true; resolve(value); }
    }).catch(error => {
      errors.push(error);
      if (!settled && --remaining === 0) {
        settled = true;
        reject(errors.find(error => ['rate_limit', 'auth', 'unavailable'].includes((error as { code?: string })?.code || '')) ?? errors[0]);
      }
    }));
  };
  const timer = setTimeout(() => {
    if (settled || signal.aborted) return;
    expanded = true;
    remaining += backups.length;
    try { onSlow(); } catch (error) { settled = true; reject(error); return; }
    for (const backup of backups) start(backup);
  }, headStartMs);
  const abort = () => { if (!settled) { settled = true; reject(signal.reason); } };
  signal.addEventListener('abort', abort, { once: true });
  start(light);
  try { return await result; }
  finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.abort(new Error('CCC candidate race finished'));
    // Join canceled work before persisting usage or starting the next level.
    if (expanded || signal.aborted) await Promise.allSettled(tasks);
  }
}
