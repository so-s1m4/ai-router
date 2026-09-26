import { spawn } from 'node:child_process';

type Window = { usedPercent: number; windowMinutes: number; resetAt?: string };
export type AgyLimits = { primary?: Window; secondary?: Window };

export function parseAgyUsage(output: string): AgyLimits | null {
  const limits: AgyLimits = {};
  for (const line of output.split(/\r?\n/)) {
    const [group, label, remainingText, resetText] = line.split('\t').map(value => value?.trim());
    if (!/^Gemini Models$/i.test(group || '')) continue;
    const minutes = /Five Hour Limit Remaining/i.test(label || '') ? 300 : /Weekly Limit Remaining/i.test(label || '') ? 10080 : null;
    const remaining = Number(remainingText?.replace('%', ''));
    if (!minutes || !/^\d+(?:\.\d+)?%$/.test(remainingText || '') || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) continue;
    const window: Window = { usedPercent: 100 - remaining, windowMinutes: minutes };
    if (resetText && Number.isFinite(Date.parse(resetText))) window.resetAt = new Date(resetText).toISOString();
    if (minutes === 300) limits.primary = window;
    else limits.secondary = window;
  }
  return limits.primary || limits.secondary ? limits : null;
}

export async function readAgyUsage(command: string, home: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<AgyLimits | null> {
  if (signal.aborted) throw new Error('Проверка лимита отменена');
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-p', '/usage', '--output-format', 'text'], { env: { ...env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '', settled = false;
    const finish = (failure?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else resolve(parseAgyUsage(output));
    };
    const abort = () => { child.kill('SIGTERM'); finish(new Error('Проверка лимита отменена')); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Проверка лимита Gemini превысила время ожидания')); }, 20_000);
    child.stdout.on('data', (part: Buffer) => { output += part.toString(); if (output.length > 64_000) abort(); });
    child.stderr.on('data', (part: Buffer) => { error = (error + part.toString()).slice(-2_000); });
    child.on('error', err => finish(err));
    child.on('close', code => code === 0 ? finish() : finish(new Error(error || `Antigravity CLI завершился: ${code}`)));
    signal.addEventListener('abort', abort, { once: true });
  });
}
