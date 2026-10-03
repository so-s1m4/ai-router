import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountsService } from './accounts.service';
import { ApiService } from './api.service';
import { ModelsService } from './models.service';
import { SharedAccessService } from './shared-access.service';
import { AccessGrant } from './models';

describe('Shared access editor', () => {
  const blacklist = signal<string[]>([]);
  let service: SharedAccessService;
  let request: jasmine.Spy;
  beforeEach(() => {
    blacklist.set(['disabled']);
    request = jasmine.createSpy('request').and.resolveTo([]);
    TestBed.configureTestingModule({ providers: [
      { provide: AccountsService, useValue: {
        accounts: signal([
          { models: [{ id: 'enabled', label: 'Enabled' }, { id: 'disabled', label: 'Disabled' }] },
          { models: [{ id: 'enabled', label: 'Enabled' }] },
          { shared: true, models: [{ id: 'incoming', label: 'Incoming' }] },
        ]), refreshAccounts: async () => {},
      } },
      { provide: ModelsService, useValue: { isModelEnabled: (id: string) => !blacklist().includes(id) } },
      { provide: ApiService, useValue: { request } },
    ] });
    service = TestBed.inject(SharedAccessService);
  });
  it('lists and selects only enabled own models, including when editing existing grants', () => {
    expect(service.grantAvailableModels().map(m => m.id)).toEqual(['enabled']);
    service.openGrantEditor();
    expect(service.grantModels).toEqual(['enabled']);
    service.openGrantEditor({ models: ['enabled', 'disabled', 'removed'] } as AccessGrant);
    expect(service.grantModels).toEqual(['enabled']);
  });
  it('removes models disabled after opening from the submitted invitation', async () => {
    blacklist.set([]);
    service.openGrantEditor();
    service.grantUsername = ' friend ';
    blacklist.set(['disabled']);
    await service.saveGrant();
    expect(JSON.parse(request.calls.first().args[1].body)).toEqual({
      username: 'friend', budget: 1000000, period: 'monthly', models: ['enabled'],
    });
  });
  it('rejects invalid budgets and empty enabled selections before sending', async () => {
    service.openGrantEditor();
    service.grantUsername = 'friend';
    for (const budget of [NaN, 0, 1.5, 1_000_000_000_001]) {
      service.grantBudget = budget;
      await service.saveGrant();
      expect(service.error()).toContain('whole number');
    }
    service.grantBudget = 100;
    blacklist.set(['disabled', 'enabled']);
    await service.saveGrant();
    expect(service.error()).toContain('enabled model');
    expect(request).not.toHaveBeenCalled();
  });
});
