import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountsService } from './accounts.service';
import { ApiService } from './api.service';
import { ModelsService } from './models.service';
import { ProjectsService } from './projects.service';
import { SessionsService } from './sessions.service';
import { Account } from './models';

describe('Shared token model selection', () => {
  it('offers only granted models and removes them when access is revoked', () => {
    const accounts = signal<Account[]>([{
      id: 'grant:codex', provider: 'codex', name: 'Shared Codex', shared: true,
      models: [{ id: 'permitted-model', label: 'Permitted' }], mode: 'runner', auth: 'unknown',
      detail: '', limit: { source: 'unknown', primary: null, secondary: null, cooldownUntil: null, updatedAt: null },
    }]);
    TestBed.configureTestingModule({ providers: [
      { provide: AccountsService, useValue: { accounts } },
      { provide: ApiService, useValue: {} },
      { provide: ProjectsService, useValue: { projects: signal([]), selectedProjectId: signal('') } },
      { provide: SessionsService, useValue: { current: signal(null) } },
    ] });
    const service = TestBed.inject(ModelsService);
    expect(service.pickerModels().map(m => m.id)).toEqual(['permitted-model']);
    expect(service.allCodexModels().map(m => m.id)).toEqual(['permitted-model']);
    expect(service.allGeminiModels()).toEqual([]);
    expect(service.allChatGPTModels()).toEqual([]);
    service.selectedService.set('codex');
    expect(service.models().map(m => m.id)).toEqual(['auto', 'permitted-model', 'default']);
    accounts.set([]);
    expect(service.pickerModels()).toEqual([]);
    expect(service.allCodexModels()).toEqual([]);
  });
});
