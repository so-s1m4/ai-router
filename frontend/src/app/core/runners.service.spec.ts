import { TestBed } from '@angular/core/testing';
import { RunnersService } from './runners.service';
import { ApiService } from './api.service';
import { Runner } from './models';

const runner: Runner = { id: 'runner', name: 'Device', online: true, managementOnline: false, createdAt: '2026-10-24T00:00:00Z' };

describe('Runner deletion', () => {
  it('removes the runner, closes management and selects another available runner', async () => {
    const service = TestBed.inject(RunnersService);
    spyOn(window, 'confirm').and.returnValue(true);
    const remaining: Runner = { id: 'other', name: 'Other device', online: true, managementOnline: false, createdAt: '2026-10-24T00:00:00Z' };
    const request = spyOn(TestBed.inject(ApiService), 'request').and.callFake((url: string) =>
      Promise.resolve(url === '/runners' ? [remaining] : { ok: true }) as any);
    spyOn(service, 'refreshAccounts').and.resolveTo();
    service.runners.set([runner, remaining]);
    service.managedRunner.set(runner);
    service.selectedRunner = runner.id;
    await service.deleteRunner(runner);
    expect(request).toHaveBeenCalledWith('/runners/runner/permanent', { method: 'DELETE' });
    expect(service.runners()).toEqual([remaining]);
    expect(service.managedRunner()).toBeNull();
    expect(service.selectedRunner).toBe('other');
    expect(service.deletingRunner()).toBe('');
  });

  it('preserves the runner after cancellation or a server error', async () => {
    const service = TestBed.inject(RunnersService);
    const confirm = spyOn(window, 'confirm').and.returnValue(false);
    const request = spyOn(TestBed.inject(ApiService), 'request').and.rejectWith(new Error('Delete failed'));
    service.runners.set([runner]);
    await service.deleteRunner(runner);
    expect(request).not.toHaveBeenCalled();
    confirm.and.returnValue(true);
    await service.deleteRunner(runner);
    expect(service.runners()).toEqual([runner]);
    expect(service.error()).toBe('Delete failed');
    expect(service.deletingRunner()).toBe('');
  });
});
