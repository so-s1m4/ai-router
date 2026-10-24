import { TestBed } from '@angular/core/testing';
import { ChatService } from './chat.service';
import { ApiService } from './api.service';
import { SessionsService } from './sessions.service';
import { UsageService } from './usage.service';
import { QueueTask } from './models';
import { NavigationService } from './navigation.service';

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

  it('places refinements between saved activity and the continuing response', () => {
    const base = { sessionId: 'chat', runId: 'run', at: '2026-10-01T10:02:00.000Z', type: 'status' };
    chat.onEvent({ ...base, id: 'event1', data: { timelineVersion: 1,
      timelineEntry: { id: 'action', role: 'assistant', kind: 'activity', text: 'Read file', at: base.at } } });
    chat.onEvent({ ...base, id: 'event2', data: { timelineVersion: 2,
      steeringMessage: { id: 'clarification', role: 'user', text: 'Change direction', at: base.at } } });
    chat.onEvent({ ...base, type: 'delta', id: 'event3', text: 'Continuing', data: { timelineVersion: 3,
      timelineEntry: { id: 'reply', role: 'assistant', text: 'Continuing', at: base.at } } });
    expect(chat.history().map(m => m.text)).toEqual(['Old request', 'Read file', 'Change direction', 'Continuing']);
    chat.resetRun();
    expect(chat.history().length).toBe(4);
  });

  it('preserves newer history when an older session reload finishes after a live event', async () => {
    const old = sessions.current()!;
    let finish!: (value: unknown) => void;
    spyOn(TestBed.inject(ApiService), 'request').and.returnValue(new Promise(resolve => finish = resolve));
    const pending = chat.reloadCurrent();
    chat.onEvent({ id: 'event', type: 'tool', sessionId: 'chat', runId: 'run', data: { timelineVersion: 1,
      timelineEntry: { id: 'action', role: 'assistant', kind: 'activity', text: 'Read file' } } });
    finish(old);
    await pending;
    expect(chat.history().map(m => m.text)).toEqual(['Old request', 'Read file']);
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

  it('deletes the current chat and clears the composer and run state', async () => {
    spyOn(window, 'confirm').and.returnValue(true);
    spyOn(TestBed.inject(NavigationService), 'navigateChat');
    const request = spyOn(TestBed.inject(ApiService), 'request').and.resolveTo({ ok: true });
    spyOn(usage, 'refreshTasks').and.resolveTo();
    sessions.sessions.set([sessions.current()!, { ...sessions.current()!, id: 'other' }]);
    chat.draft = 'Unsent message';
    chat.running.set(true);
    await chat.deleteSession('chat');
    expect(request).toHaveBeenCalledOnceWith('/sessions/chat', { method: 'DELETE' });
    expect(sessions.sessions().map(s => s.id)).toEqual(['other']);
    expect(sessions.current()).toBeNull();
    expect(chat.running()).toBeFalse();
    expect(chat.draft).toBe('');
  });

  it('deletes multiple chats with one confirmation and retains failures for retry', async () => {
    const confirm = spyOn(window, 'confirm').and.returnValue(true);
    spyOn(TestBed.inject(NavigationService), 'navigateChat');
    const request = spyOn(TestBed.inject(ApiService), 'request').and.callFake((url: string) =>
      url === '/sessions/other' ? Promise.reject(new Error('Server unavailable')) : Promise.resolve({ ok: true }) as any);
    spyOn(usage, 'refreshTasks').and.resolveTo();
    sessions.sessions.set([sessions.current()!, { ...sessions.current()!, id: 'other' }]);
    const deleted = await chat.deleteSessions(['chat', 'other', 'chat']);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(deleted).toEqual(['chat']);
    expect(sessions.sessions().map(s => s.id)).toEqual(['other']);
    expect(sessions.current()).toBeNull();
    expect(chat.error()).toContain('1 chats could not be deleted');
    expect(chat.deletingSessions().size).toBe(0);
  });

  it('cancels bulk deletion before making requests and prevents overlapping deletes', async () => {
    const confirm = spyOn(window, 'confirm').and.returnValue(false);
    let finish!: (value: unknown) => void;
    const request = spyOn(TestBed.inject(ApiService), 'request').and.returnValue(new Promise(resolve => finish = resolve));
    spyOn(usage, 'refreshTasks').and.resolveTo();
    expect(await chat.deleteSessions(['other'])).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    confirm.and.returnValue(true);
    const pending = chat.deleteSessions(['other']);
    expect(await chat.deleteSessions(['other'])).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    expect(await pending).toEqual(['other']);
    expect(chat.deletingSessions().size).toBe(0);
  });

  it('ignores a failed reload after the current chat is removed', async () => {
    let reject!: (reason: Error) => void;
    spyOn(TestBed.inject(ApiService), 'request').and.returnValue(new Promise((_, fail) => reject = fail));
    const pending = chat.reloadCurrent();
    sessions.current.set(null);
    reject(new Error('Chat not found'));
    await pending;
    expect(sessions.current()).toBeNull();
    expect(chat.error()).toBe('');
  });

  it('keeps the chat when deletion is canceled or fails', async () => {
    const confirm = spyOn(window, 'confirm').and.returnValue(false);
    const request = spyOn(TestBed.inject(ApiService), 'request').and.rejectWith(new Error('Delete failed'));
    await chat.deleteSession('chat');
    expect(request).not.toHaveBeenCalled();
    confirm.and.returnValue(true);
    await chat.deleteSession('chat');
    expect(sessions.current()?.id).toBe('chat');
    expect(chat.error()).toBe('Delete failed');
    expect(chat.deletingSessions().size).toBe(0);
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
