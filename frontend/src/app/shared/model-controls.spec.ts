import { TestBed } from '@angular/core/testing';
import { ModelControlsComponent } from './model-controls';
import { WorkspaceStore } from '../core/workspace.store';

describe('CCC execution mode', () => {
  it('shows fixed solver settings and preserves ordinary choices when returning', () => {
    const fixture = TestBed.createComponent(ModelControlsComponent);
    const vm = TestBed.inject(WorkspaceStore);
    vm.modelService.selectedService.set('gemini');
    vm.modelService.selectedModel.set('custom-model');
    fixture.detectChanges();
    const mode = fixture.nativeElement.querySelector('[aria-label="Execution mode"]') as HTMLSelectElement;
    mode.value = 'ccc-auto'; mode.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(vm.modelService.workflow()).toBe('ccc-auto');
    expect(fixture.nativeElement.textContent).toContain('6.1 Sol · medium · Fast');
    expect(fixture.nativeElement.querySelector('[aria-label="Provider"]')).toBeNull();
    mode.value = 'standard'; mode.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(vm.modelService.selectedService()).toBe('gemini');
    expect(vm.modelService.selectedModel()).toBe('custom-model');
    expect(fixture.nativeElement.querySelector('[aria-label="Provider"]')).not.toBeNull();
  });
});
