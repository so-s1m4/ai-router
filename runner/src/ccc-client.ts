import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { PersonalMcp } from './personal-mcp.js';

export interface CccClient {
  ready?(): Promise<void>;
  call(name: string, args: Record<string, unknown>): Promise<any>;
  close(): Promise<void>;
}

export class CccConnectionError extends Error {
  readonly code = 'ccc_mcp';
}

export function cccConnectionFailure(error: unknown, personal: boolean): CccConnectionError {
  const source = personal ? 'your personal MCP settings' : 'the MCP settings on this runner';
  return new CccConnectionError(`Unable to connect to CCC MCP (${personal ? 'personal' : 'runner default'}): ${retryReason(error)}; check ${source}`, { cause: error });
}

export class CccToolError extends Error {
  constructor(public status?: number, public retryAfterMs?: number) {
    super(`CCC MCP operation failed${status ? ` (HTTP ${status})` : ''}; check access or server status`);
  }
}

export function submissionRateLimit(error: unknown): CccToolError | undefined {
  if (error instanceof CccToolError && error.status === 429) return error;
  if (error instanceof Error && error.cause) return submissionRateLimit(error.cause);
  return undefined;
}

export function toolData(result: any): any {
  let value = result.structuredContent;
  if (!value) {
    const text = result.content?.find((item: any) => item.type === 'text')?.text;
    try { value = JSON.parse(text); } catch {
      if (result.isError) throw new CccToolError();
      throw new Error('CCC MCP returned an invalid response');
    }
  }
  if (result.isError || value.ok === false) {
    // Do not include server messages: they may contain authenticated URLs.
    const status = Number(value.error?.status);
    const retry = Number(value.error?.retry_after);
    throw new CccToolError(Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined,
      value.error?.retry_after != null && Number.isFinite(retry) && retry >= 0 ? Math.ceil(retry * 1000) : undefined);
  }
  return value.data ?? value;
}

export function cccServer(config: any, personalMcp: PersonalMcp[] = []) {
  const name = process.env.CCC_AUTO_MCP_NAME || 'ccc';
  const personal = personalMcp.find(server => server.name === name);
  const server = personal || config.mcpServers?.[name];
  if (!server || server.enabled === false || server.disabled === true) throw new CccConnectionError(`Configure the ${name} MCP server on this runner or in your personal MCP settings to use CCC авто`);
  return server;
}

async function connectOnce(signal: AbortSignal, personalMcp: PersonalMcp[]): Promise<CccClient> {
  const root = process.env.RUNNER_DATA_DIR || '/runner-data';
  const config = JSON.parse(await readFile(path.join(root, 'global-mcp/.gemini/config/mcp_config.json'), 'utf8').catch(() => '{"mcpServers":{}}'));
  const server = cccServer(config, personalMcp);
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
    if (error instanceof Error && /Configure|missing/.test(error.message)) throw new CccConnectionError(error.message, { cause: error });
    throw cccConnectionFailure(error, personalMcp.includes(server));
  }
}

// Recover the exact failed read rather than replaying solver work or submissions.
const recoverableTools = new Set(['game_info', 'prepare_level', 'get_level_input', 'get_artifact_download_url', 'list_archive', 'archive_member']);
function permanentFailure(error: unknown): boolean {
  const value = error as any;
  // A tool rejection is not a broken connection. Reconnecting cannot fix
  // missing contest context or a denied session; retry only explicit transient statuses.
  if (error instanceof CccToolError) return error.status !== 408 && error.status !== 429 && !(error.status && error.status >= 500);
  const status = Number(value?.status ?? value?.statusCode ?? value?.code);
  return (status >= 400 && status < 500 && status !== 408 && status !== 429)
    || [-32600, -32601, -32602].includes(Number(value?.code))
    || /Configure|missing|invalid response/.test(value?.message || '')
    || (value?.cause && permanentFailure(value.cause));
}
export function recoveringCcc(
  connect: () => Promise<CccClient>, signal: AbortSignal,
  onRetry: (attempt: number, operation: string, reason: string) => void = () => {}, retryDelays = [1000, 2000, 5000, 10000, 20000],
): CccClient {
  let connection: Promise<CccClient> | undefined;
  let closed = false;
  return {
    async ready() {
      signal.throwIfAborted();
      if (closed) throw new Error('CCC connection is closed');
      await (connection ||= connect());
    },
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
          onRetry(attempt + 1, name, retryReason(error));
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
function retryReason(error: unknown): string {
  const value = error as any;
  const status = Number(value?.status ?? value?.statusCode ?? value?.code);
  if (status >= 400 && status <= 599) return `HTTP ${status}`;
  if (value?.cause) return retryReason(value.cause);
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(value?.code)) return 'server DNS lookup failed';
  if (value?.code === 'ECONNREFUSED') return 'server refused the connection';
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(value?.code)) return 'TLS certificate verification failed';
  if (/timeout|timed out/i.test(value?.message || '')) return 'request timed out';
  return 'connection interrupted';
}
export async function connectCcc(signal: AbortSignal, onRetry?: (attempt: number, operation: string, reason: string) => void, personalMcp: PersonalMcp[] = []): Promise<CccClient> {
  return recoveringCcc(() => connectOnce(signal, personalMcp), signal, onRetry);
}
