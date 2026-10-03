import { TestBed } from '@angular/core/testing';
import { CccAutoPageComponent } from './ccc-auto-page';
import { ApiService } from '../core/api.service';
import { defaultCccAutoSettings } from '../core/ccc-settings';

describe('CCC-Auto settings',()=>{
  it('loads saved rules and sends edited model schedules back to the API',async()=>{
    const api=spyOn(TestBed.inject(ApiService),'request').and.callFake(async(path:string,options?:RequestInit)=>{
      if(path==='/accounts')return [] as any;
      if(options?.method==='PUT')return JSON.parse(options.body as string);
      return defaultCccAutoSettings() as any;
    });
    const fixture=TestBed.createComponent(CccAutoPageComponent);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.level-rule').length).toBe(5);
    const component=fixture.componentInstance;component.settings.levels[0].candidates[0].provider='openrouter';component.providerChanged(component.settings.levels[0].candidates[0]);component.settings.levels[0].candidates[0].delaySeconds=12;
    await component.save();expect(component.notice).toContain('Сохранено');
    const call=api.calls.all().find(c=>c.args[1]?.method==='PUT')!;
    const saved=JSON.parse(call.args[1]!.body as string);expect(saved.levels[0].candidates[0].model).toBe('openrouter/auto');expect(saved.levels[0].candidates[0].delaySeconds).toBe(12);expect(saved.levels[0].candidates[0].fast).toBeFalse();
  });
  it('keeps the current form when imported JSON is rejected',async()=>{
    spyOn(TestBed.inject(ApiService),'request').and.rejectWith(new Error('Invalid ranges'));
    const component=TestBed.createComponent(CccAutoPageComponent).componentInstance;
    const settings=component.settings;component.jsonDraft='{"levels":[]}';await component.importJson();
    expect(component.settings).toBe(settings);expect(component.error).toBe('Invalid ranges');
  });
});
