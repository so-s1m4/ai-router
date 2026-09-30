import { TestBed } from '@angular/core/testing';
import { AccountsPageComponent } from './accounts-page';
import { WorkspaceStore } from '../core/workspace.store';
import { Account } from '../core/models';

const account: Account = {
  id: 'test-account', name: 'My Codex', provider: 'codex', models: [], mode: 'runner',
  auth: 'ready', detail: 'Demo runner', priority: 1,
  limit: { source: 'unknown', primary: null, secondary: null, cooldownUntil: null, updatedAt: null },
};

describe('Inline accounts', () => {
  function setup(a = account) {
    const fixture = TestBed.createComponent(AccountsPageComponent);
    const vm = TestBed.inject(WorkspaceStore);
    vm.accountService.accounts.set([a]);
    fixture.detectChanges();
    return { fixture, vm, root: fixture.nativeElement as HTMLElement };
  }

  it('opens settings from the compact row and keeps the selected account current after refresh', () => {
    const { fixture, vm, root } = setup();
    expect(root.querySelector('.account-priority-row')).toBeNull();
    (root.querySelector('.account-inline-row') as HTMLButtonElement).click();
    fixture.detectChanges();
    const dialog = root.querySelector('dialog')!;
    expect(dialog.open).toBeTrue();
    expect(dialog.querySelector('.account-priority-row')).not.toBeNull();
    vm.accountService.accounts.set([{ ...account, priority: 2 }]);
    fixture.detectChanges();
    expect((dialog.querySelector('select') as HTMLSelectElement).value).toBe('2');
    // Native Escape dispatches cancel; the component must clear the selection too.
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    fixture.detectChanges();
    expect(root.querySelector('dialog')).toBeNull();
    expect(fixture.componentInstance.selectedAccountId()).toBeNull();
  });

  it('shows shared-account details without owner controls and closes on the backdrop', () => {
    const { fixture, root } = setup({ ...account, shared: true });
    (root.querySelector('.account-inline-row') as HTMLButtonElement).click();
    fixture.detectChanges();
    const dialog = root.querySelector('dialog')!;
    expect(dialog.querySelector('.account-quota-box')).not.toBeNull();
    expect(dialog.querySelector('.account-priority-row')).toBeNull();
    expect(dialog.querySelector('.btn-icon-danger')).toBeNull();
    dialog.click();
    fixture.detectChanges();
    expect(root.querySelector('dialog')).toBeNull();
  });

  it('closes the details before opening the ChatGPT session dialog', () => {
    const { fixture, vm, root } = setup({ ...account, provider: 'chatgpt' });
    spyOn(vm, 'openChatGPTSessionModal');
    (root.querySelector('.account-inline-row') as HTMLButtonElement).click();
    fixture.detectChanges();
    (root.querySelector('.account-chatgpt-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.querySelector('dialog')).toBeNull();
    expect(vm.openChatGPTSessionModal).toHaveBeenCalledWith(jasmine.objectContaining({ id: account.id }));
  });
});
