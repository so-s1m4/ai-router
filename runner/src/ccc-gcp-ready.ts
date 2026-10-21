import { setTimeout as delay } from 'node:timers/promises';

export class GcpCommandError extends Error {
  constructor(readonly code: number|null, readonly log: string) {
    super(`Google Cloud command failed (${code}): ${log}`);
  }
}

// RUNNING can precede SSH availability and completion of package installation.
// Retry only this read-only probe; solver execution must never be replayed.
export async function waitForGcpReady(
  probe: (signal: AbortSignal) => Promise<void>, signal: AbortSignal,
  timeoutMs = 90_000, retryMs = 2_000,
): Promise<void> {
  signal.throwIfAborted();
  const deadline = AbortSignal.timeout(timeoutMs);
  const readySignal = AbortSignal.any([signal, deadline]);
  try {
    while (true) {
      readySignal.throwIfAborted();
      try { await probe(readySignal); readySignal.throwIfAborted(); return; }
      catch (error) {
        readySignal.throwIfAborted();
        if (!(error instanceof GcpCommandError) || !(error.code === 75 ||
          error.code === 255 && /failed to connect to backend|connection refused|connection reset|connection closed|connection timed out/i.test(error.log) ||
          error.code === 1 && /instance.*not.*running|resource.*not.*ready|being started/i.test(error.log))) throw error;
      }
      await delay(retryMs, undefined, { signal: readySignal });
    }
  } catch (error) {
    signal.throwIfAborted();
    if (deadline.aborted) throw new Error('Google Cloud VM is not ready: SSH or runtime tools unavailable after waiting. Check VM startup logs.');
    throw error;
  }
}

export const gcpReadinessCommand = 'if command -v systemctl >/dev/null 2>&1; then case "$(systemctl show --property=ActiveState --value google-startup-scripts.service 2>/dev/null)" in activating|active|reloading|failed) exit 75;; esac; fi; node --version >/dev/null 2>&1 && python3 --version >/dev/null 2>&1 && g++ --version >/dev/null 2>&1 && command -v setsid >/dev/null && command -v timeout >/dev/null || exit 75';
