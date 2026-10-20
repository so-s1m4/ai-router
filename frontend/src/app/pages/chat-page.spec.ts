import { TestBed } from '@angular/core/testing';
import { ChatPageComponent } from './chat-page';
import { WorkspaceStore } from '../core/workspace.store';
import { Message } from '../core/models';

describe('Chat request grouping', () => {
  const user: Message = { id: 'user', role: 'user', text: 'Fix the chat' };
  const event = (id: string, text: string, activity = false, runId = 'request-1'): Message =>
    ({ id, role: 'assistant', text, runId, provider: 'codex', ...(activity ? { kind: 'activity' as const } : {}) });

  function setup(timeline: Message[]) {
    const fixture = TestBed.createComponent(ChatPageComponent);
    const vm = TestBed.inject(WorkspaceStore);
    vm.sessionService.current.set({ id: 'chat', title: 'Chat', updatedAt: '', messages: [user], timeline });
    return { fixture, vm };
  }

  it('renders a single answer and keeps intermediate text and tools in chronological order', () => {
    const { fixture } = setup([user, event('start', 'Accepted', true), event('first', 'Checking'),
      event('tool', 'Tool', true), event('second', 'Building'), event('final', 'Done')]);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.assistant-row').length).toBe(1);
    expect(root.querySelectorAll('.assistant-actions').length).toBe(1);
    expect(root.querySelector('.assistant-content > .message-text')?.textContent).toContain('Done');
    const details = root.querySelector('details')!;
    expect(details.open).toBeFalse();
    expect([...details.querySelectorAll('.turn-progress-entry')].map(el => el.textContent?.trim()))
      .toEqual(['Accepted', 'Checking', 'Tool', 'Building']);
    details.querySelector('summary')!.click();
    expect(details.open).toBeTrue();
    fixture.destroy();
  });

  it('updates the same request without adding a second live assistant header', () => {
    const { fixture, vm } = setup([user, event('first', 'Checking'), event('tool', 'Tool', true)]);
    vm.chatService.runId.set('request-1');
    vm.chatService.running.set(true);
    fixture.detectChanges();
    const details = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    vm.sessionService.current.update(chat => ({ ...chat!, timeline: [...chat!.timeline!, event('next', 'Building')] }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.assistant-row').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.turn-live-status').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.assistant-content > .message-text').textContent).toContain('Building');
    expect(fixture.nativeElement.querySelector('details')).toBe(details);
    expect(details.open).toBeTrue();
    fixture.destroy();
  });

  it('keeps distinct requests and user refinements separate, including legacy messages', () => {
    const { fixture } = setup([user, event('first', 'First result'), event('other', 'Second result', false, 'request-2'),
      { ...user, id: 'refinement', text: 'Also fix spacing' }, event('third', 'Refined result', false, 'request-2'),
      { id: 'legacy', role: 'assistant', text: 'Old message' }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.user-row').length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.assistant-row').length).toBe(4);
    fixture.destroy();
  });
});
