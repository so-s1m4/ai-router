import { TestBed } from '@angular/core/testing';
import { AccountsService } from './accounts.service';
import { ModelsService } from './models.service';
import { ApiService } from './api.service';
import { CccAutoPageComponent } from '../pages/ccc-auto-page';

describe('Cerebras connection workflow',()=>{
  it('creates an API key connection and clears the key draft after saving',async()=>{
    const accounts=TestBed.inject(AccountsService);
    const api=spyOn(TestBed.inject(ApiService),'request').and.resolveTo({});
    spyOn(accounts,'refreshAccounts').and.resolveTo();
    accounts.accountProvider='cerebras';accounts.accountName='Cerebras';accounts.selectedRunner='runner';
    await accounts.addAccount();
    expect(JSON.parse(api.calls.mostRecent().args[1]!.body as string)).toEqual({provider:'cerebras',name:'Cerebras',runnerId:'runner',authType:'api_key'});
    accounts.apiKeyDrafts['cerebras-account']='csk-private-key';
    await accounts.saveOpenAIKey({id:'cerebras-account',provider:'cerebras',authType:'api_key'} as any);
    expect(api.calls.mostRecent().args[0]).toBe('/accounts/cerebras-account/api-key');
    expect(accounts.apiKeyDrafts['cerebras-account']).toBe('');
  });

  it('keeps Cerebras selected when another provider exposes the same model and shows reasoning',()=>{
    const accounts=TestBed.inject(AccountsService);const models=TestBed.inject(ModelsService);
    const model={id:'gpt-oss-120b',label:'GPT OSS',reasoning:[{id:'medium',label:'Medium'}]};
    accounts.accounts.set([{id:'codex',provider:'codex',models:[model]},{id:'cerebras',provider:'cerebras',models:[model]}] as any);
    models.selectService('cerebras');models.selectModel(model.id);
    expect(models.selectedService()).toBe('cerebras');
    expect(models.hasAccountsFor('cerebras')).toBeTrue();
    expect(models.reasoningOptions().some(r=>r.id==='medium')).toBeTrue();
    models.modelBlacklist.set([model.id]);
    expect(models.models().some(m=>m.id===model.id)).toBeFalse();
    expect(models.cerebrasEnabledCount()).toBe(0);
  });

  it('selects the connected Cerebras model for CCC and limits reasoning choices',()=>{
    const component=TestBed.createComponent(CccAutoPageComponent).componentInstance;
    component.accounts.accounts.set([{id:'cerebras',provider:'cerebras',models:[{id:'gpt-oss-120b',label:'GPT OSS',reasoning:[{id:'medium',label:'Medium'}]}]}] as any);
    const candidate=component.settings.levels[0].candidates[0];candidate.provider='cerebras';
    component.providerChanged(candidate);
    expect(candidate.model).toBe('gpt-oss-120b');expect(candidate.fast).toBeFalse();
    expect(component.candidateReasonings(candidate)).toEqual(['default','medium']);
  });
});
