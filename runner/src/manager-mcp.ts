import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Provider = 'codex' | 'antigravity';
const root = process.env.RUNNER_DATA_DIR || '/runner-data';
function homeFor(accountId: string) { if (!/^[a-f0-9-]{36}$/.test(accountId)) throw new Error('Неверный аккаунт'); return path.join(root, 'accounts', accountId, 'home'); }
function safeName(name: string) { if (!/^[a-zA-Z0-9_-]{1,50}$/.test(name)) throw new Error('Название MCP: буквы, цифры, _ или -'); return name; }
export async function ensureHome(accountId: string) { const home = homeFor(accountId); await mkdir(path.join(home, '.codex'), { recursive: true, mode: 0o700 }); return home; }
async function run(bin: string, args: string[], home: string) {
  await mkdir(path.join(home, '.codex'), { recursive: true, mode: 0o700 });
  return new Promise<string>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, CODEX_HOME: path.join(home, '.codex'), SSL_CERT_FILE: process.env.SSL_CERT_FILE, HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY };
    const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.stdout.on('data', (part: Buffer) => { out = (out + part.toString()).slice(-100_000); });
    child.stderr.on('data', (part: Buffer) => { err = (err + part.toString()).slice(-2_000); });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(err || out || `CLI завершился: ${code}`)); });
  });
}
const agyFile = (home: string) => path.join(home, '.gemini', 'config', 'mcp_config.json');
async function readAgy(home: string): Promise<{ mcpServers: Record<string, any> }> { try { const raw = JSON.parse(await readFile(agyFile(home), 'utf8')); return { ...raw, mcpServers: raw.mcpServers && typeof raw.mcpServers === 'object' ? raw.mcpServers : {} }; } catch (error: any) { if (error?.code === 'ENOENT') return { mcpServers: {} }; throw new Error('Не удалось прочитать конфигурацию Antigravity MCP'); } }
async function writeAgy(home: string, value: { mcpServers: Record<string, any> }) { const file = agyFile(home); await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); const temp = file + '.tmp'; await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(temp, file); }
export type McpInput = { accountId: string; provider: Provider; name?: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> };
function sanitized(name: string, item: any) { const value = item?.transport || item; return { name, url: value?.url || value?.serverUrl || null, command: value?.command || null, args: value?.args || [], envNames: Object.keys(value?.env || {}), enabled: item?.enabled !== false && item?.disabled !== true }; }
export async function listMcp(input: McpInput) {
  const home = homeFor(input.accountId);
  if (input.provider === 'antigravity') { const config = await readAgy(home); return Object.entries(config.mcpServers).map(([name, item]) => sanitized(name, item)); }
  const raw = JSON.parse(await run('codex', ['mcp', 'list', '--json'], home));
  return Array.isArray(raw) ? raw.map(item => sanitized(item.name, item)) : Object.entries(raw).map(([name, item]) => sanitized(name, item));
}
export async function addMcp(input: McpInput) {
  const home = homeFor(input.accountId), name = safeName(input.name || '');
  if (!!input.url === !!input.command) throw new Error('Укажите URL или команду MCP');
  if (input.url && !/^https:\/\//.test(input.url)) throw new Error('MCP URL должен использовать HTTPS');
  if (input.command && (input.command.length > 200 || /[\r\n]/.test(input.command))) throw new Error('Неверная команда MCP');
  if ((input.args || []).some(arg => arg.length > 500) || Object.entries(input.env || {}).some(([key, value]) => !/^[A-Z_][A-Z0-9_]*$/.test(key) || value.length > 2000)) throw new Error('Неверные параметры MCP');
  if (input.provider === 'antigravity') { const config = await readAgy(home); config.mcpServers[name] = input.url ? { serverUrl: input.url } : { command: input.command, args: input.args || [], env: input.env || {} }; await writeAgy(home, config); }
  else { const args = ['mcp', 'add', name]; if (input.url) args.push('--url', input.url); else { for (const [key, value] of Object.entries(input.env || {})) args.push('--env', `${key}=${value}`); args.push('--', input.command!, ...(input.args || [])); } await run('codex', args, home); }
  return listMcp(input);
}
export async function removeMcp(input: McpInput) {
  const home = homeFor(input.accountId), name = safeName(input.name || '');
  if (input.provider === 'antigravity') { const config = await readAgy(home); delete config.mcpServers[name]; await writeAgy(home, config); }
  else await run('codex', ['mcp', 'remove', name], home);
  return listMcp(input);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; if (input.length > 32_000) process.stdin.destroy(new Error('Слишком большой запрос')); });
  process.stdin.on('end', async () => {
    try {
      const { op, payload } = JSON.parse(input) as { op: string; payload: McpInput };
      const result = op === 'ensureHome' ? await ensureHome(payload.accountId)
        : op === 'mcp.list' ? await listMcp(payload)
        : op === 'mcp.add' ? await addMcp(payload)
        : op === 'mcp.remove' ? await removeMcp(payload)
        : (() => { throw new Error('Операция не поддерживается'); })();
      process.stdout.write(JSON.stringify(result));
    } catch (error) { process.stderr.write(error instanceof Error ? error.message : 'Ошибка настройки аккаунта'); process.exitCode = 1; }
  });
}
