import { TestBed } from '@angular/core/testing';
import { ModelsPageComponent } from './models-page';
import { Account } from '../core/models';

describe('Model management', () => {
  it('keeps provider lists compact, expands them and searches hidden models', () => {
    const fixture = TestBed.createComponent(ModelsPageComponent);
    const page = fixture.componentInstance;
    const service = page.vm.modelService;
    service.accounts.set([{
      id: 'router', provider: 'openrouter', models: Array.from({ length: 30 }, (_, i) => ({
        id: `vendor/model-${i}`, label: `Model ${i}`,
      })),
    } as Account]);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelectorAll('.provider-card')[3];
    expect(card.querySelectorAll('.model-row').length).toBe(5);
    card.querySelector('.models-expand').click();
    fixture.detectChanges();
    expect(card.querySelectorAll('.model-row').length).toBe(30);
    card.querySelector('.models-expand').click();
    fixture.detectChanges();
    expect(card.querySelectorAll('.model-row').length).toBe(5);
    service.providerModelSearch.set('model-29');
    fixture.detectChanges();
    expect(card.querySelectorAll('.model-row').length).toBe(1);
    expect(card.textContent).toContain('Model 29');
    service.providerModelSearch.set('');
    service.modelBlacklist.set(['vendor/model-29']);
    service.providerModelFilter.set('disabled');
    fixture.detectChanges();
    expect(card.querySelectorAll('.model-row').length).toBe(1);
    expect(card.textContent).toContain('Model 29');
  });
});
