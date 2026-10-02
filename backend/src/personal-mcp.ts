import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prepareUser, userDir } from './store.js';

export const personalMcpSchema = z.object({
  name: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,50}$/),
  url: z.string().max(2000).url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }),
  headers: z.record(z.string().max(4000)).default({}).refine(headers => {
    const names = Object.keys(headers);
    return names.length <= 30 && new Set(names.map(name => name.toLowerCase())).size === names.length &&
      names.every(name => /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(name)) &&
      Object.values(headers).every(value => !/[^\t\x20-\x7e\x80-\xff]/.test(value)) && JSON.stringify(headers).length <= 16000;
  }),
}).strict();
export type PersonalMcp = z.infer<typeof personalMcpSchema>;
const fileFor = (userId: string) => path.join(userDir(userId), 'personal-mcp.json');
export async function readPersonalMcp(userId: string): Promise<PersonalMcp[]> {
  try { return z.array(personalMcpSchema).parse(JSON.parse(await readFile(fileFor(userId), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export const publicPersonalMcp = (servers: PersonalMcp[]) => servers.map(({ name, url, headers }) => ({ name, url, headerNames: Object.keys(headers) }));
const queues = new Map<string, Promise<unknown>>();
export function mutatePersonalMcp(userId: string, mutate: (servers: PersonalMcp[]) => PersonalMcp[]) {
  const task = (queues.get(userId) || Promise.resolve()).catch(() => {}).then(async () => {
    await prepareUser(userId);
    const servers = mutate(await readPersonalMcp(userId));
    if (servers.length > 20) throw new Error('At most 20 personal MCP servers');
    const file = fileFor(userId);
    await writeFile(file + '.tmp', JSON.stringify(servers), { mode: 0o600 });
    await rename(file + '.tmp', file);
    return publicPersonalMcp(servers);
  });
  queues.set(userId, task);
  void task.finally(() => { if (queues.get(userId) === task) queues.delete(userId); }).catch(() => {});
  return task;
}
