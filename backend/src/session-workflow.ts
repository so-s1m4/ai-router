import type { ChatSession } from './types.js';
import type { QueueTask } from './task-queue.js';

export function sessionWorkflow(chat: ChatSession, tasks: QueueTask[]): 'standard'|'ccc-auto' {
  if (chat.workflow) return chat.workflow;
  // Recover the original mode of chats created before mode was persisted.
  const first = tasks.filter(task => task.input.sessionId === chat.id)
    .sort((a,b) => a.createdAt.localeCompare(b.createdAt))[0];
  return first?.input.workflow === 'ccc-auto' ? 'ccc-auto' : 'standard';
}
