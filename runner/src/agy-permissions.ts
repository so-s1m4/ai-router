import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Headless Antigravity cannot show approval prompts. Keep this list scoped to
// commands used to inspect and build a project rather than approving all tools.
export const taskCommandRules = [
  'command(git)',
  'command(pwd)',
  'command(ls)',
  'command(find)',
  'command(rg)',
  'command(grep)',
  'command(cat)',
  'command(sed)',
  'command(head)',
  'command(tail)',
  'command(wc)',
  'command(sort)',
  'command(npm ci)',
  'command(npm install)',
  'command(npm run build)',
  'command(npm run test)',
  'command(npm run lint)',
];

export async function ensureAgyTaskPermissions(home: string): Promise<void> {
  const file = path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid Antigravity settings');
    settings = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const permissions = settings.permissions && typeof settings.permissions === 'object' && !Array.isArray(settings.permissions)
    ? settings.permissions as Record<string, unknown>
    : {};
  const existing = Array.isArray(permissions.allow) ? permissions.allow.filter((rule): rule is string => typeof rule === 'string') : [];
  const allow = [...new Set([...existing, ...taskCommandRules])];
  if (typeof settings.enableTerminalSandbox === 'boolean' && existing.length === allow.length) return;

  settings.permissions = { ...permissions, allow };
  // The runner is already isolated by Docker. Nested Linux namespaces can
  // fail in the container, while an explicit user setting is still respected.
  if (settings.enableTerminalSandbox === undefined) settings.enableTerminalSandbox = false;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, file);
}
