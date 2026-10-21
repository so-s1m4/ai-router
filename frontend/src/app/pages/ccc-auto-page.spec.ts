import { TestBed } from '@angular/core/testing';
import { CccAutoPageComponent } from './ccc-auto-page';
import { ApiService } from '../core/api.service';
import { defaultCccAutoSettings } from '../core/ccc-settings';

describe('CCC-Auto settings',()=>{
  it('loads saved rules and sends edited model schedules back to the API',async()=>{
    const api=spyOn(TestBed.inject(ApiService),'request').and.callFake(async(path:string,options?:RequestInit)=>{
      if(path==='/accounts'||path==='/runners')return [] as any;
      if(options?.method==='PUT')return JSON.parse(options.body as string);
      return defaultCccAutoSettings() as any;
    });
    const fixture=TestBed.createComponent(CccAutoPageComponent);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.level-rule').length).toBe(5);
    const mode = fixture.nativeElement.querySelector('option[value="python"]') as HTMLOptionElement;
    expect(mode.textContent).toContain('Python');
    expect(fixture.componentInstance.settings.levels[0].candidates[0].mode).toBe('python');
    const component=fixture.componentInstance;component.settings.levels[0].candidates[0].provider='openrouter';component.providerChanged(component.settings.levels[0].candidates[0]);component.settings.levels[0].candidates[0].delaySeconds=12;
    const candidate=component.settings.levels[0].candidates[0];
    component.setRoutingProviders(candidate,'google-ai-studio/flex, google-vertex google-vertex');
    expect(candidate.openRouterRouting?.only).toEqual(['google-ai-studio/flex','google-vertex']);
    fixture.detectChanges();
    const flexButton=Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b=>b.textContent?.includes('Google AI Studio Flex only'))!;
    flexButton.click();fixture.detectChanges();
    await component.save();expect(component.notice).toContain('Saved');
    const call=api.calls.all().find(c=>c.args[1]?.method==='PUT')!;
    const saved=JSON.parse(call.args[1]!.body as string);expect(saved.levels[0].candidates[0].model).toBe('openrouter/auto');expect(saved.levels[0].candidates[0].delaySeconds).toBe(12);expect(saved.levels[0].candidates[0].fast).toBeFalse();expect(saved.levels[0].candidates[0].openRouterRouting).toEqual({only:['google-ai-studio/flex'],allowFallbacks:false});
    expect(saved.levels[0].candidates[0].mode).toBe('python');
  });
  it('completes Google authorization in settings and excludes the code from saved JSON',async()=>{
    const api=spyOn(TestBed.inject(ApiService),'request').and.callFake(async(path:string,options?:RequestInit)=>{
      const body=JSON.parse(options?.body as string||'{}');
      if(path==='/ccc-auto/gcp/auth')return (body.action==='start'?{flowId:'flow',url:'https://accounts.google.com/o/oauth2/auth',expiresAt:Date.now()+600000}:{connected:true,email:'user@example.com'}) as any;
      return body as any;
    });
    const component=TestBed.createComponent(CccAutoPageComponent).componentInstance;
    component.runners=[{id:'runner',name:'Runner',online:true}];component.addGcp();
    await component.gcpAuth('start');expect(component.gcpFlow?.flowId).toBe('flow');
    component.gcpCode='valid-code';await component.gcpAuth('complete');
    expect(component.gcpConnected).toBeTrue();expect(component.gcpEmail).toBe('user@example.com');
    expect(component.gcpCode).toBe('');expect(component.gcpFlow).toBeUndefined();
    component.exportJson();expect(component.jsonDraft).not.toContain('valid-code');
    const request=api.calls.all().find(c=>JSON.parse(c.args[1]?.body as string||'{}').action==='complete')!;
    expect(JSON.parse(request.args[1]!.body as string)).toEqual({runnerId:'runner',action:'complete',flowId:'flow',code:'valid-code'});
  });
  it('sends VM actions with current form settings and renders operation feedback',async()=>{
    const api=spyOn(TestBed.inject(ApiService),'request').and.callFake(async(path:string)=>{
      if(path==='/accounts'||path==='/runners')return [] as any;
      if(path==='/ccc-auto/settings')return defaultCccAutoSettings() as any;
      return {status:'Creation requested'} as any;
    });
    const fixture=TestBed.createComponent(CccAutoPageComponent),component=fixture.componentInstance;
    fixture.detectChanges();await fixture.whenStable();
    component.addGcp();component.settings.gcp!.runnerId='runner';component.gcpConnected=true;
    component.settings.gcp!.machineType='e2-standard-16';
    fixture.detectChanges();
    const button=Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b=>b.textContent?.trim()==='Create VM')!;
    button.click();await fixture.whenStable();fixture.detectChanges();
    const call=api.calls.mostRecent();expect(call.args[0]).toBe('/ccc-auto/gcp/vm');
    expect(JSON.parse(call.args[1]!.body as string)).toEqual({action:'create',settings:component.settings.gcp});
    expect(fixture.nativeElement.textContent).toContain('Creation requested');
    expect(component.gcpVmBusy).toBeFalse();
  });
  it('keeps feedback from an old VM out of the current form',async()=>{
    let resolve!:(value:any)=>void;
    spyOn(TestBed.inject(ApiService),'request').and.callFake(()=>new Promise<any>(r=>resolve=r));
    const component=TestBed.createComponent(CccAutoPageComponent).componentInstance;
    component.addGcp();const request=component.gcpVm('start');component.settings.gcp!.instance='another-vm';
    resolve({status:'Old VM started'});await request;
    expect(component.gcpVmStatus).toBe('');expect(component.gcpVmBusy).toBeFalse();
  });
  it('offers Gemini subscription CLI with account models and disables Codex Fast',()=>{
    const fixture=TestBed.createComponent(CccAutoPageComponent);
    const component=fixture.componentInstance;
    const candidate=component.settings.levels[0].candidates[0];
    candidate.provider='antigravity';candidate.openRouterRouting={only:['google-ai-studio/flex'],allowFallbacks:false};
    component.providerChanged(candidate);
    expect(candidate.model).toBe('default');expect(candidate.reasoning).toBe('default');expect(candidate.fast).toBeFalse();expect(candidate.openRouterRouting).toBeUndefined();
    expect(component.candidateReasonings(candidate)).toEqual(['default']);
    component.loading=false;fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('option[value="antigravity"]').textContent).toContain('subscription');
  });
  it('offers shared connections and only their allowed models',()=>{
    const component=TestBed.createComponent(CccAutoPageComponent).componentInstance;
    component.accounts.accounts.set([{id:'grant:openrouter',provider:'openrouter',shared:true,models:[{id:'allowed',label:'Allowed'}]} as any]);
    const candidate=component.settings.levels[0].candidates[0];candidate.provider='openrouter';candidate.accountId='grant:openrouter';
    expect(component.candidateAccounts(candidate).map(a=>a.id)).toEqual(['grant:openrouter']);
    expect(component.models(candidate).map(m=>m.id)).toEqual(['allowed']);
  });
  it('keeps the current form when imported JSON is rejected',async()=>{
    spyOn(TestBed.inject(ApiService),'request').and.rejectWith(new Error('Invalid ranges'));
    const component=TestBed.createComponent(CccAutoPageComponent).componentInstance;
    const settings=component.settings;component.jsonDraft='{"levels":[]}';await component.importJson();
    expect(component.settings).toBe(settings);expect(component.error).toBe('Invalid ranges');
  });
});
