import { TestBed } from '@angular/core/testing';
import { ChatComposerComponent } from './chat-composer';
import { WorkspaceStore } from '../core/workspace.store';

describe('Composer action', () => {
  function setup() {
    const fixture = TestBed.createComponent(ChatComposerComponent);
    const vm = TestBed.inject(WorkspaceStore);
    const button = () => {
      fixture.detectChanges();
      const buttons = fixture.nativeElement.querySelectorAll('.hero-pill-bar > .pill-btn-send');
      expect(buttons.length).toBe(1);
      return buttons[0] as HTMLButtonElement;
    };
    return { fixture, vm, button };
  }

  it('uses one fixed button for stop, clarification and send', () => {
    const { vm, button } = setup();
    const action = button();
    expect(action.disabled).toBeTrue();
    vm.chatService.running.set(true);
    expect(button()).toBe(action);
    expect(action.getAttribute('aria-label')).toBe('Stop task');
    expect(getComputedStyle(action).gridColumnStart).toBe('3');
    const cancel = spyOn(vm.chatService, 'cancel').and.resolveTo();
    action.click();
    expect(cancel).toHaveBeenCalledTimes(1);
    vm.chatService.draft = 'Add a detail';
    vm.chatService.steeringAvailable.set(true);
    expect(button()).toBe(action);
    expect(action.getAttribute('aria-label')).toBe('Clarify the current task');
    const steer = spyOn(vm.chatService, 'steer').and.resolveTo();
    action.click();
    expect(steer).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    vm.chatService.running.set(false);
    expect(button()).toBe(action);
    expect(action.getAttribute('aria-label')).toBe('Send');
    const send = spyOn(vm.chatService, 'send').and.resolveTo();
    action.click();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('preserves typed text during dictation and blocks Enter until dictation finishes', async () => {
    const { fixture, vm, button } = setup();
    const component = fixture.componentInstance;
    vm.chatService.draft = 'Задача:';
    spyOn(component.voice, 'start').and.callFake(async commit => { commit('проверь сборку'); });
    component.toggleVoice();
    expect(vm.chatService.draft).toBe('Задача: проверь сборку');
    component.voice.active.set(true);
    expect(button().disabled).toBeTrue();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    component.composerKey(enter);
    expect(enter.defaultPrevented).toBeTrue();
    component.voice.active.set(false);
    fixture.destroy();
  });

  it('allows stop during upload and treats whitespace as an empty draft', () => {
    const { vm, button } = setup();
    vm.chatService.running.set(true);
    vm.chatService.draft = '  \n ';
    vm.filesService.uploading.set(true);
    expect(button().getAttribute('aria-label')).toBe('Stop task');
    expect(button().disabled).toBeFalse();
    vm.chatService.canceling.set(true);
    expect(button().disabled).toBeTrue();
    expect(button().getAttribute('aria-label')).toBe('Stopping…');
  });

  it('preserves unsupported clarification and blocks duplicate submissions', () => {
    const { vm, button } = setup();
    vm.chatService.running.set(true);
    vm.chatService.draft = 'Keep this detail';
    const cancel = spyOn(vm.chatService, 'cancel').and.resolveTo();
    const send = spyOn(vm.chatService, 'send').and.resolveTo();
    expect(button().disabled).toBeTrue();
    expect(button().title).toContain('unavailable');
    button().click();
    expect(cancel).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(vm.chatService.draft).toBe('Keep this detail');
    vm.chatService.steeringAvailable.set(true);
    expect(button().disabled).toBeFalse();
    vm.chatService.steeringSending.set(true);
    expect(button().disabled).toBeTrue();
    vm.chatService.steeringSending.set(false);
    vm.filesService.uploading.set(true);
    expect(button().disabled).toBeTrue();
    vm.filesService.uploading.set(false);
    vm.chatService.canceling.set(true);
    expect(button().disabled).toBeTrue();
    vm.chatService.canceling.set(false);
    vm.chatService.running.set(false);
    vm.chatService.taskSubmitting.set(true);
    expect(button().disabled).toBeTrue();
  });
});
