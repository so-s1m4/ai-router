import { spawn } from 'node:child_process';
import type { AccountModel } from './cli.js';

export function parseAgyModels(output: string): AccountModel[] {
  const clean = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '\n');
  const lines = clean.split(/\n/).map(l => l.trim()).filter(Boolean);
  const modelsMap = new Map<string, AccountModel>();

  for (const line of lines) {
    if (/fetching available models/i.test(line)) continue;
    const parts = line.split(/\t+|\s{2,}/);
    const id = parts[0]?.trim();
    if (!id || id.startsWith('Fetching')) continue;
    const fullLabel = parts[1]?.trim() || id;

    const match = id.match(/^(gemini-[a-z0-9_.-]+)-(low|medium|high|max)$/i);
    if (match) {
      const baseId = match[1];
      const effort = match[2].toLowerCase();
      const effortLabels: Record<string, string> = {
        low: 'Низкое',
        medium: 'Среднее',
        high: 'Высокое',
        max: 'Максимальное'
      };
      const baseLabel = fullLabel.replace(/\s*\((?:High|Medium|Low|Max)\)$/i, '');

      if (!modelsMap.has(baseId)) {
        modelsMap.set(baseId, {
          id: baseId,
          label: baseLabel,
          defaultReasoning: 'high',
          reasoning: []
        });
      }
      const existing = modelsMap.get(baseId)!;
      if (!existing.reasoning) existing.reasoning = [];
      if (!existing.reasoning.some(r => r.id === effort)) {
        existing.reasoning.push({ id: effort, label: effortLabels[effort] || effort });
      }
    } else {
      if (!modelsMap.has(id)) {
        modelsMap.set(id, { id, label: fullLabel });
      }
    }
  }

  return [...modelsMap.values()];
}

export async function readAgyModels(command: string, home: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<AccountModel[] | null> {
  if (signal.aborted) return null;
  return new Promise(resolve => {
    const child = spawn(command, ['models'], { env: { ...env, HOME: home }, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '', settled = false;
    const finish = (result: AccountModel[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => { child.kill('SIGTERM'); finish(null); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(null); }, 10_000);
    child.stdout.on('data', (part: Buffer) => {
      output += part.toString();
      if (output.length > 64_000) abort();
    });
    child.on('error', () => finish(null));
    child.on('close', code => {
      if (code === 0 && output.trim()) {
        const parsed = parseAgyModels(output);
        finish(parsed.length ? parsed : null);
      } else {
        finish(null);
      }
    });
    signal.addEventListener('abort', abort, { once: true });
  });
}
