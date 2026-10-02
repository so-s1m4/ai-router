export const lightHeadStartMs = 20_000;

// Keep candidates alive until serialized platform validation accepts a winner.
export async function raceLight<T>(
  light: (signal: AbortSignal) => Promise<T>,
  backups: ((signal: AbortSignal) => Promise<T>)[],
  signal: AbortSignal,
  onSlow: () => void,
  headStartMs = lightHeadStartMs,
  options: { background?: (signal: AbortSignal) => Promise<T>; recoverLight?: (error: unknown, signal: AbortSignal) => Promise<T>; accept?: (value: T) => Promise<boolean>; rejectedLightBackground?: (signal: AbortSignal) => Promise<T>; lightRetries?: number; onCleanup?: (elapsedMs: number, drained: boolean) => void | Promise<void> } = {},
): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const candidateSignal = AbortSignal.any([signal, controller.signal]);
  const tasks: Promise<void>[] = [];
  let expanded = false, settled = false, remaining = 1;
  const errors: unknown[] = [];
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  let validation = Promise.resolve();
  let backgroundStarted = Boolean(options.background);
  let lightRetries = options.lightRetries ?? 0;
  const fatal = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
  const start = (run: (signal: AbortSignal) => Promise<T>, isLight = false) => {
    tasks.push(Promise.resolve().then(() => run(candidateSignal)).then(value => {
      candidateSignal.throwIfAborted();
      const check = validation.then(async () => {
        if (settled) return;
        let accepted: boolean;
        try { accepted = options.accept ? await options.accept(value) : true; }
        catch (error) { fatal(error); return; }
        if (settled) return;
        candidateSignal.throwIfAborted();
        if (accepted) { settled = true; resolve(value); return; }
        if (isLight) {
          if (lightRetries-- > 0) { remaining++; start(light, true); }
          if (!backgroundStarted && options.rejectedLightBackground) {
            backgroundStarted = true;
            remaining++;
            start(options.rejectedLightBackground);
          }
        }
      });
      validation = check.catch(fatal);
      return check;
    }).catch(error => {
      errors.push(error);
      if (['rate_limit', 'auth', 'unavailable'].includes((error as { code?: string })?.code || '')) fatal(error);
    }).finally(() => {
      if (!settled && --remaining === 0 && (expanded || (!options.background && !options.recoverLight && !options.rejectedLightBackground) || !backups.length)) {
        fatal(errors[0] ?? new Error('CCC candidates rejected by platform'));
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
  start(async candidateSignal => {
    try { return await light(candidateSignal); }
    catch (error) {
      candidateSignal.throwIfAborted();
      if (!options.recoverLight || options.background) throw error;
      backgroundStarted = true;
      return options.recoverLight(error, candidateSignal);
    }
  }, true);
  if (options.background) { remaining++; start(options.background); }
  try { return await result; }
  finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.abort(new Error('CCC candidate race finished'));
    const started = Date.now();
    let drained = false;
    let cleanupTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled(tasks).then(() => { drained = true; }),
      new Promise<void>(resolve => { cleanupTimer = setTimeout(resolve, 100); }),
    ]);
    clearTimeout(cleanupTimer);
    await options.onCleanup?.(Date.now() - started, drained);
  }
}
