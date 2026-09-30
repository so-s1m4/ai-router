import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TaskCheckpoint } from './checkpoint.js';
import type { Job } from './cli.js';

// Manual continuation must fail before creating a new checkpoint or executing commands.
export async function restoreCheckpoint(job: Job, workspace: string) {
  let previous: TaskCheckpoint;
  try {
    previous = JSON.parse(await readFile(path.join(workspace, '.ai-router', 'tasks', job.continuationOf || job.taskId, 'checkpoint.json'), 'utf8'));
  } catch {
    if (job.continuationOf) throw new Error('Saved checkpoint is unavailable on this runner');
    return;
  }
  if (!previous || previous.taskId !== (job.continuationOf || job.taskId) || previous.sessionId !== job.sessionId || previous.projectId !== job.projectId || typeof previous.prompt !== 'string') {
    if (job.continuationOf) throw new Error('Checkpoint does not match this workspace');
    return;
  }
  if (job.continuationOf && previous.status === 'completed') throw new Error('The checkpoint task already completed; refresh the chat before continuing');
  job.originalPrompt = previous.prompt || job.prompt;
  if (previous.accountId === job.accountId) job.previousThreadId = previous.threadId;
  if (job.continuationOf || previous.accountId !== job.accountId) {
    job.handoffContext = [previous.priorContext || '', `Previous provider output:\n${(previous.partialText || '').slice(-12000)}`, `Previous error:\n${(previous.error || '').slice(-1000)}`].filter(Boolean).join('\n\n').slice(-20000);
    job.prompt = `Original request:\n${previous.prompt.slice(0, 16000)}\n\n${job.handoffContext}\n\n${job.prompt}`.slice(0, 39000);
  }
}
