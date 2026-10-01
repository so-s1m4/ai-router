import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export interface CccClient {
  call(name: string, args: Record<string, unknown>): Promise<any>;
  close(): Promise<void>;
}

export function toolData(result: any): any {
  let value = result.structuredContent;
  if (!value) {
    const text = result.content?.find((item: any) => item.type === 'text')?.text;
    try { value = JSON.parse(text); } catch { throw new Error('CCC MCP returned an invalid response'); }
  }
  if (result.isError || value.ok === false) {
    // Do not include server messages: they may contain authenticated URLs.
    throw new Error('CCC MCP operation failed; check access, cooldown and server status');
  }
  return value.data ?? value;
}

async function connectOnce(signal: AbortSignal): Promise<CccClient> {
  const root = process.env.RUNNER_DATA_DIR || '/runner-data';
  const config = JSON.parse(await readFile(path.join(root, 'global-mcp/.gemini/config/mcp_config.json'), 'utf8').catch(() => '{"mcpServers":{}}'));
  const name = process.env.CCC_AUTO_MCP_NAME || 'ccc';
  const server = config.mcpServers?.[name];
  if (!server || server.enabled === false || server.disabled === true) throw new Error(`Configure the ${name} MCP server on this runner to use CCC авто`);
  const client = new Client({ name: 'ai-router-ccc-auto', version: '1.0.0' });
  const headers = server.headers || {};
  const url = server.serverUrl || server.url;
  const transport = url
    ? new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers }, reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } })
    : new StdioClientTransport({ command: server.command, args: server.args || [], env: { PATH: process.env.PATH || '', ...server.env }, stderr: 'ignore' });
  const stop = () => { void client.close().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted();
    try { await client.connect(transport, { timeout: 30_000, signal }); }
    catch (error) {
      await transport.close().catch(() => {});
      if (!url || signal.aborted || ![404, 405].includes(Number((error as any)?.code))) throw error;
      await client.connect(new SSEClientTransport(new URL(url), { requestInit: { headers }, eventSourceInit: { fetch: (input, init) => fetch(input, { ...init, headers }) } }), { timeout: 30_000, signal });
    }
    const listed: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({ cursor }, { signal, timeout: 30_000 });
      listed.push(...page.tools.map(tool => tool.name)); cursor = page.nextCursor;
    } while (cursor);
    for (const required of ['game_info', 'prepare_level', 'get_level_input', 'get_artifact_download_url', 'upload_artifact', 'submit_solution']) {
      if (!listed.includes(required)) throw new Error(`CCC MCP is missing ${required}`);
    }
    return {
      async call(name, args) {
        signal.throwIfAborted();
        try { return toolData(await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 120_000 })); }
        catch (error) {
          if (signal.aborted) throw error;
          throw new Error(`CCC MCP ${name} failed; check access or server status`, { cause: error });
        }
      },
      async close() { signal.removeEventListener('abort', stop); await client.close(); },
    };
  } catch (error) {
    signal.removeEventListener('abort', stop); await client.close().catch(() => {});
    if (signal.aborted) throw error;
    throw new Error(error instanceof Error && /Configure|missing/.test(error.message) ? error.message : 'Unable to connect to CCC MCP; check its settings on this runner', { cause: error });
  }
}

// Recover the exact failed read rather than replaying solver work or submissions.
const recoverableTools = new Set(['game_info', 'prepare_level', 'get_level_input', 'get_artifact_download_url', 'list_archive', 'archive_member']);
function permanentFailure(error: unknown): boolean {
  const value = error as any;
  return [400, 401, 403].includes(Number(value?.code ?? value?.status))
    || /Configure|missing|invalid response/.test(value?.message || '')
    || (value?.cause && permanentFailure(value.cause));
}
export function recoveringCcc(
  connect: () => Promise<CccClient>, signal: AbortSignal,
  onRetry: (attempt: number) => void = () => {}, retryDelays = [1000, 2000, 5000, 10000, 20000],
): CccClient {
  let connection: Promise<CccClient> | undefined;
  let closed = false;
  return {
    async call(name, args) {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        if (closed) throw new Error('CCC connection is closed');
        const current = connection ||= connect();
        try { return await (await current).call(name, args); }
        catch (error) {
          if (signal.aborted || !recoverableTools.has(name) || permanentFailure(error) || attempt >= retryDelays.length) throw error;
          if (connection === current) {
            connection = undefined;
            await current.then(client => client.close()).catch(() => {});
          }
          onRetry(attempt + 1);
          await delay(retryDelays[attempt], undefined, { signal });
        }
      }
    },
    async close() {
      closed = true;
      const current = connection; connection = undefined;
      await current?.then(client => client.close()).catch(() => {});
    },
  };
}
export async function connectCcc(signal: AbortSignal, onRetry?: (attempt: number) => void): Promise<CccClient> {
  return recoveringCcc(() => connectOnce(signal), signal, onRetry);
}
