import { TestBed } from '@angular/core/testing';
import { WorkspaceStore as App } from './core/workspace.store';
import { ApiService } from './core/api.service';
import { provideRouter } from '@angular/router';
import { FilesPageComponent } from './pages/files-page';
import { ChatPageComponent } from './pages/chat-page';
import { DomSanitizer } from '@angular/platform-browser';

describe('Shared project connection availability', () => {
  it('offers models on another runner for shared projects while private projects stay on their runner', () => {
    const app = TestBed.configureTestingModule({ providers: [provideRouter([])] }).inject(App);
    app.accountService.accounts.set([
      {
        id: 'connection',
        provider: 'codex',
        name: 'My connection',
        runnerId: 'my-runner',
        models: [{ id: 'runner-model', label: 'Runner model' }],
        mode: 'runner',
        auth: 'ready',
        detail: '',
        limit: {
          source: 'unknown',
          primary: null,
          secondary: null,
          cooldownUntil: null,
          updatedAt: null,
        },
      },
    ]);
    const project = {
      id: 'project',
      name: 'Shared project',
      runnerId: 'friend-runner',
      createdAt: '2026-09-30',
      updatedAt: '2026-09-30',
      shared: true,
    };
    app.projectService.projects.set([project]);
    app.projectService.selectedProjectId.set(project.id);
    app.modelService.selectedService.set('codex');
    expect(app.modelService.hasAccountsFor('codex')).toBeTrue();
    expect(app.modelService.models().some((m) => m.id === 'runner-model')).toBeTrue();
    app.projectService.projects.set([{ ...project, shared: false }]);
    expect(app.modelService.hasAccountsFor('codex')).toBeFalse();
    expect(app.modelService.models().some((m) => m.id === 'runner-model')).toBeFalse();
  });
});
