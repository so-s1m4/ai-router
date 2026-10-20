import assert from 'node:assert/strict';
import test from 'node:test';
import { appendTimelineMessage, recordTimelineEvent } from './run-timeline.js';
import type { AIEvent, ChatSession } from './types.js';

function session(): ChatSession {
  return { id: 'chat', title: 'Task', createdAt: 'now', updatedAt: 'now', messages: [
    { id: 'prompt', role: 'user', text: 'Start', at: 'now' },
  ] };
}
let nextId = 0;
function event(type: AIEvent['type'], text: string): AIEvent {
  return { id: String(++nextId), sessionId: 'chat', runId: 'run', at: 'now', type,
    ...(type === 'delta' ? { text } : { message: text }) };
}

test('keeps partial replies, tools and refinements in arrival order through completion', () => {
  const chat = session();
  recordTimelineEvent(chat, event('delta', 'Before'));
  recordTimelineEvent(chat, event('tool', 'Read file'));
  const refinement = { id: 'refinement', role: 'user' as const, text: 'Change direction', at: 'now' };
  appendTimelineMessage(chat, refinement);
  chat.messages.push(refinement);
  recordTimelineEvent(chat, event('delta', 'After'));
  recordTimelineEvent(chat, event('delta', ' clarification'));
  chat.messages.push({ id: 'answer', role: 'assistant', runId: 'run', text: 'After clarification', at: 'now', tokenUsage: { totalTokens: 42 } });
  recordTimelineEvent(chat, event('completed', 'Done'));
  assert.deepEqual(chat.timeline?.map(row => row.text), ['Start', 'Before', 'Read file', 'Change direction', 'After clarification']);
  assert.equal(chat.timeline?.at(-1)?.tokenUsage?.totalTokens, 42);
  assert.deepEqual(chat.messages.map(row => row.text), ['Start', 'Change direction', 'After clarification']);
});

test('retains every action and partial text after cancellation and a JSON round trip', () => {
  const chat = session();
  for (let i = 0; i < 20; i++) recordTimelineEvent(chat, event('tool', `Action ${i}`));
  recordTimelineEvent(chat, event('delta', 'Unfinished response'));
  recordTimelineEvent(chat, event('error', 'Stopped by user'));
  const restored: ChatSession = JSON.parse(JSON.stringify(chat));
  assert.equal(restored.timeline?.length, 23);
  assert.equal(restored.timeline?.at(-2)?.text, 'Unfinished response');
  assert.equal(restored.timeline?.at(-1)?.text, 'Stopped by user');
});

test('retains the final answer when the runner does not stream it', () => {
  const chat = session();
  recordTimelineEvent(chat, event('delta', 'Working…'));
  chat.messages.push({ id: 'answer', role: 'assistant', runId: 'run', text: 'Final answer', at: 'now' });
  recordTimelineEvent(chat, event('completed', 'Done'));
  assert.deepEqual(chat.timeline?.map(row => row.text), ['Start', 'Working…', 'Final answer']);
});
