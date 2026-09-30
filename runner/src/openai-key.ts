import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AccountModel } from './cli.js';

export function apiTextModels(data: unknown): AccountModel[] {
  if (!Array.isArray(data)) throw new Error('OpenAI API returned incorrect model directory');
  const ids = data.flatMap(row => typeof row?.id === 'string' ? [row.id] : []);
  // Codex uses Responses with text and tools; specialized media/legacy models are not task models.
  return [...new Set(ids)].filter(id => /^(gpt-\d|o[134](?:-|$)|codex-)/.test(id)
    && !/audio|realtime|transcri|tts|image|search|instruct|chat|deep-research|gpt-3|gpt-4-turbo|gpt-4-0/.test(id)
    && id !== 'gpt-4').sort((a,b) => b.localeCompare(a,undefined,{numeric:true})).map(id => ({id,label:id}));
}

export async function fetchApiModels(apiKey: string, signal?: AbortSignal): Promise<AccountModel[]> {
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
    });
  } catch { throw new Error('OpenAI API is unavailable or timed out'); }
  if (!response.ok) {
    // Never forward provider bodies: they can contain fragments of credentials.
    throw new Error(response.status === 401 ? 'OpenAI API: invalid or revoked key'
      : response.status === 403 ? 'OpenAI API: key is not allowed to read models'
      : response.status === 429 ? 'OpenAI API: Request limit exceeded'
      : `OpenAI API: HTTP error ${response.status}`);
  }
  const value = await response.json() as {data?:unknown};
  return apiTextModels(value.data);
}

export async function readApiKey(home: string): Promise<string | undefined> {
  try {
    const auth = JSON.parse(await readFile(path.join(home,'.codex','auth.json'),'utf8'));
    return typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY ? auth.OPENAI_API_KEY : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Failed to read API authorization on runner');
  }
}

export async function saveApiKey(home: string, apiKey: string): Promise<void> {
  if (!/^sk-[A-Za-z0-9_-]{17,509}$/.test(apiKey)) throw new Error('OpenAI API key format is incorrect');
  const models = await fetchApiModels(apiKey);
  if (!models.length) throw new Error('The key does not have text models for Codex tasks');
  const dir = path.join(home,'.codex');
  await mkdir(dir,{recursive:true,mode:0o700});
  const tmp = path.join(dir,`auth-${randomUUID()}.tmp`);
  await writeFile(tmp,JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:apiKey}),{mode:0o600});
  await rename(tmp,path.join(dir,'auth.json'));
}
