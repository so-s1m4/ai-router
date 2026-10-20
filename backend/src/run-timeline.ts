import type { AIEvent, ChatSession, Message } from './types.js';

// The transcript used as model context stays separate from the visible event history.
export function appendTimelineMessage(chat: ChatSession, message: Message) {
  chat.timeline ??= [...chat.messages];
  if (!chat.timeline.some(row => row.id === message.id)) chat.timeline.push({ ...message });
  chat.timelineVersion = (chat.timelineVersion || 0) + 1;
}

export function recordTimelineEvent(chat: ChatSession, event: AIEvent): Message | undefined {
  chat.timeline ??= [...chat.messages];
  const rows = chat.timeline;
  const last = rows.at(-1);
  let row: Message;
  if (event.type === 'delta' && event.text) {
    if (last?.role === 'assistant' && last.kind !== 'activity' && last.runId === event.runId && last.provider === event.provider) {
      last.text += event.text;
      row = last;
    } else {
      row = { id: event.id, role: 'assistant', text: event.text, at: event.at, runId: event.runId, provider: event.provider };
      rows.push(row);
    }
  } else if (event.type === 'completed') {
    const answer = [...chat.messages].reverse().find(message => message.role === 'assistant' && message.runId === event.runId);
    if (!answer) return;
    const streamed = rows.filter(message => message.runId === event.runId && message.kind !== 'activity');
    if (answer.text && streamed.map(message => message.text).join('').endsWith(answer.text) && streamed.length) {
      row = streamed.at(-1)!;
      row.tokenUsage = answer.tokenUsage;
      row.model = answer.model;
      row.accountId = answer.accountId;
    } else {
      row = { ...answer };
      rows.push(row);
    }
  } else if (event.message && ['started', 'status', 'tool', 'fallback', 'checkpoint', 'handoff_started', 'handoff_ready', 'error'].includes(event.type)) {
    row = { id: event.id, role: 'assistant', kind: 'activity', text: event.message, at: event.at, runId: event.runId, provider: event.provider };
    rows.push(row);
  } else return;
  chat.timelineVersion = (chat.timelineVersion || 0) + 1;
  return row;
}
