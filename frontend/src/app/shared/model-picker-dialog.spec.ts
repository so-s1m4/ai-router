import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelPickerDialogComponent } from './model-picker-dialog';
import { WorkspaceStore } from '../core/workspace.store';

describe('Model picker', () => {
  function setup() {
    const models = signal([
      { id: 'auto', label: 'Auto' },
      { id: 'default', label: 'Default' },
      { id: 'gpt-example', label: 'GPT Example · Codex' },
      { id: 'anthropic/claude-example', label: 'Claude Example · OpenRouter' },
    ]);
    const modelSearch = signal('');
    const selectedModel = signal('gpt-example');
    const vm = {
      loggedIn: signal(true), modelMenuOpen: signal(true), modelSearch,
      modelService: { models, selectedModel, currentServiceLabel: () => 'Auto' },
      filteredPickerModels: computed(() => models().filter(m =>
        (m.label + ' ' + m.id).toLowerCase().includes(modelSearch().trim().toLowerCase()))),
      closeModelPicker: jasmine.createSpy('closeModelPicker'),
      choosePickerModel: jasmine.createSpy('choosePickerModel'),
      onModelPickerKey: () => {},
    };
    TestBed.configureTestingModule({ providers: [{ provide: WorkspaceStore, useValue: vm }] });
    const fixture = TestBed.createComponent(ModelPickerDialogComponent);
    fixture.detectChanges();
    return { fixture, vm };
  }

  it('shows every available model without collapsing and selects a model', () => {
    const { fixture, vm } = setup();
    const options = fixture.nativeElement.querySelectorAll('.model-picker-option');
    expect(options.length).toBe(4);
    expect(fixture.nativeElement.querySelector('details')).toBeNull();
    options[3].click();
    expect(vm.choosePickerModel).toHaveBeenCalledWith('anthropic/claude-example');
  });

  it('searches all models by ID, with an empty state', () => {
    const { fixture, vm } = setup();
    vm.modelSearch.set('anthropic/');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.model-picker-option').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Claude Example');
    vm.modelSearch.set('no-match');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No models found');
  });
});
