import { TestBed } from '@angular/core/testing';
import { ChatComposerComponent } from './chat-composer';
import { WorkspaceStore } from '../core/workspace.store';

describe('Running task composer', () => {
  it('keeps Stop and Clarify in separate cells and sends clicks to cancellation', () => {
    const fixture = TestBed.createComponent(ChatComposerComponent);
    const vm = TestBed.inject(WorkspaceStore);
    vm.chatService.running.set(true);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const stop = root.querySelector('[aria-label="Stop task"]') as HTMLButtonElement;
    const clarify = root.querySelector('[aria-label="Clarify the current task"]') as HTMLButtonElement;
    expect(getComputedStyle(stop).gridColumnStart).toBe('3');
    expect(getComputedStyle(clarify).gridColumnStart).toBe('4');
    const cancel = spyOn(vm.chatService, 'cancel').and.resolveTo();
    stop.click();
    expect(cancel).toHaveBeenCalledTimes(1);
    vm.chatService.canceling.set(true);
    fixture.detectChanges();
    expect(stop.disabled).toBeTrue();
  });
});
