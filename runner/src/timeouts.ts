export type RunMode = 'chat' | 'task';

export function cliTimeoutSeconds(mode: RunMode): number {
  const fallback = mode === 'task' ? 3600 : 180;
  const key = mode === 'task' ? 'CLI_TASK_TIMEOUT_SECONDS' : 'CLI_TIMEOUT_SECONDS';
  const configured = Number(process.env[key]);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 86400) : fallback;
}
