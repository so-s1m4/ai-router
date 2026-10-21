import { TestBed } from '@angular/core/testing';
import { ChatComposerComponent } from './chat-composer';
import { AccountsService } from '../core/accounts.service';
import { WorkspaceStore } from '../core/workspace.store';

describe('CCC execution mode', () => {
  it('shows fixed solver settings and preserves ordinary choices when returning', () => {
    const fixture = TestBed.createComponent(ChatComposerComponent);
    fixture.componentRef.setInput('hero', true);
    const vm = TestBed.inject(WorkspaceStore);
    vm.modelService.selectedService.set('gemini');
    vm.modelService.selectedModel.set('custom-model');
    fixture.detectChanges();
    const mode = fixture.nativeElement.querySelector('[aria-label="Execution mode"]') as HTMLDivElement;
    (mode.querySelectorAll('button')[1] as HTMLButtonElement).click(); fixture.detectChanges();
    expect(vm.modelService.workflow()).toBe('ccc-auto');
    expect(fixture.nativeElement.textContent).toContain('Configure CCC');
    expect(fixture.nativeElement.querySelector('[aria-label="Provider"]')).toBeNull();
    (mode.querySelectorAll('button')[0] as HTMLButtonElement).click(); fixture.detectChanges();
    expect(vm.modelService.selectedService()).toBe('gemini');
    expect(vm.modelService.selectedModel()).toBe('custom-model');
    expect(fixture.nativeElement.querySelector('[aria-label="Provider"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.model-picker-trigger')).not.toBeNull();
    expect(mode.textContent).toContain('Normal');
    expect(mode.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
  });
  it('hides the execution mode switch in an existing chat for both workflows', () => {
    const fixture = TestBed.createComponent(ChatComposerComponent);
    const vm = TestBed.inject(WorkspaceStore);
    for (const workflow of ['standard', 'ccc-auto'] as const) {
      vm.modelService.workflow.set(workflow);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[aria-label="Execution mode"]')).toBeNull();
      expect(vm.modelService.workflow()).toBe(workflow);
    }
  });

  it('offers all providers after choosing a model, without Auto or Standard controls', () => {
    const fixture = TestBed.createComponent(ChatComposerComponent);
    const vm = TestBed.inject(WorkspaceStore);
    fixture.detectChanges();
    const controls = fixture.nativeElement.querySelector('app-model-controls');
    expect(controls.textContent).not.toContain('Auto');
    expect(controls.textContent).not.toContain('Standard');
    TestBed.inject(AccountsService).accounts.set([
      { id: 'gemini', provider: 'antigravity', models: [{ id: 'gemini-test', label: 'Gemini test' }] },
      { id: 'codex', provider: 'codex', models: [{ id: 'codex-test', label: 'Codex test' }] },
    ] as any);
    vm.modelService.selectService('codex');
    const gemini = vm.modelService.pickerModels().find(m => m.label.endsWith('· Gemini'))!;
    expect(gemini).toBeDefined();
    expect(vm.modelService.pickerModels().some(m => ['auto', 'default'].includes(m.id))).toBeFalse();
    vm.choosePickerModel(gemini.id);
    expect(vm.modelService.selectedModel()).toBe(gemini.id);
    expect(vm.modelService.selectedService()).toBe('gemini');
    expect(vm.modelService.pickerModels().some(m => m.label.endsWith('· Codex'))).toBeTrue();
  });

});
