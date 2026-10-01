import { TestBed } from '@angular/core/testing';
import { ChatService } from './chat.service';
import { ApiService } from './api.service';
import { SessionsService } from './sessions.service';
import { UsageService } from './usage.service';
import { QueueTask } from './models';

const interrupted: QueueTask = {
  id: 'old-task', input: { sessionId: 'chat', prompt: 'Old request', model: 'default' },
  state: 'canceled', priority: 1, message: 'Stopped by user',
  createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:01:00.000Z',
  recovery: { checkpoint: true, updatedAt: '2026-10-01T10:01:00.000Z', partialText: '', activity: [] },
};

describe('Chat task controls', () => {
  let chat: ChatService;
  let sessions: SessionsService;
  let usage: UsageService;
  beforeEach(() => {
    chat = TestBed.inject(ChatService);
    sessions = TestBed.inject(SessionsService);
    usage = TestBed.inject(UsageService);
    sessions.current.set({ id: 'chat', title: 'Task', updatedAt: interrupted.updatedAt,
      messages: [{ id: 'original', role: 'user', text: 'Old request', at: interrupted.createdAt }] });
    usage.tasks.set([interrupted]);
  });

  it('cancels through HTTP even without a connected realtime socket and prevents duplicate requests', async () => {
    let finish!: (value: unknown) => void;
    const request = spyOn(TestBed.inject(ApiService), 'request').and.returnValue(new Promise(resolve => finish = resolve));
    spyOn(usage, 'refreshTasks').and.resolveTo();
    chat.runId.set('active-task');
    chat.running.set(true);
    const pending = chat.cancel();
    await chat.cancel();
    expect(request).toHaveBeenCalledOnceWith('/tasks/active-task', { method: 'DELETE' });
    expect(chat.canceling()).toBeTrue();
    finish({ ok: true });
    await pending;
    expect(chat.canceling()).toBeFalse();
    expect(chat.notice()).toBe('Stopping task…');
  });

  it('shows cancellation failures and leaves the stop control available to retry', async () => {
    spyOn(TestBed.inject(ApiService), 'request').and.rejectWith(new Error('Server unavailable'));
    chat.runId.set('active-task');
    chat.running.set(true);
    await chat.cancel();
    expect(chat.error()).toBe('Server unavailable');
    expect(chat.running()).toBeTrue();
    expect(chat.canceling()).toBeFalse();
  });

  it('hides saved progress after a later user message, including after reopening the chat', () => {
    expect(chat.currentInterruptedTasks()).toEqual([interrupted]);
    sessions.current.update(s => ({ ...s!, messages: [...s!.messages,
      { id: 'next', role: 'user', text: 'New request', at: '2026-10-01T10:02:00.000Z' }] }));
    expect(chat.currentInterruptedTasks()).toEqual([]);
    usage.tasks.set([{ ...interrupted }]);
    expect(chat.currentInterruptedTasks()).toEqual([]);
  });

  it('hides saved progress as soon as the next message is accepted into the queue', () => {
    usage.tasks.set([interrupted, { ...interrupted, id: 'next', state: 'queued',
      createdAt: '2026-10-01T10:02:00.000Z' }]);
    expect(chat.currentInterruptedTasks()).toEqual([]);
  });

  it('keeps saved progress for assistant replies and messages in another chat', () => {
    sessions.current.update(s => ({ ...s!, messages: [...s!.messages,
      { id: 'reply', role: 'assistant', text: 'Partial response', at: '2026-10-01T10:02:00.000Z' }] }));
    usage.tasks.set([interrupted, { ...interrupted, id: 'other', input: { ...interrupted.input, sessionId: 'other-chat' },
      createdAt: '2026-10-01T10:02:00.000Z' }]);
    expect(chat.currentInterruptedTasks()).toEqual([interrupted]);
  });
});
