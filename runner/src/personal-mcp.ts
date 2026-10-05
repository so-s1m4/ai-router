import { readFile } from 'node:fs/promises';
import { parse } from 'smol-toml';
import { z } from 'zod';
export const personalMcpSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
  url: z.string().max(2000).url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }),
  headers: z.record(z.string().max(4000)).default({}),
}).strict();
export type PersonalMcp = z.infer<typeof personalMcpSchema>;
export async function personalMcpOverrides(home: string, job: {personalMcp?:PersonalMcp[];sharedExecution?:boolean;solverOnly?:boolean}) {
  const overrides: Record<string, unknown> = {};
  const config = parse(await readFile(`${home}/.codex/config.toml`, 'utf8').catch(error => { if(error.code === 'ENOENT') return ''; throw error; })) as any;
  const personalNames = new Set((job.personalMcp || []).map(server => server.name));
  // Personal entries exist only in this thread/process, never in the account configuration.
  for (const name of Object.keys(config.mcp_servers || {})) {
    if (name.startsWith('personal_') || personalNames.has(name) || job.sharedExecution || job.solverOnly) overrides[`mcp_servers.${name}.enabled`] = false;
  }
  for (const server of job.personalMcp || []) overrides[`mcp_servers.personal_${server.name}`] = {
    url: server.url, http_headers: server.headers, enabled: !job.solverOnly,
  };
  return overrides;
}
