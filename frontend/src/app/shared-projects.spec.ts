import { App } from './app';
import { DomSanitizer } from '@angular/platform-browser';

describe('Shared project connection availability',()=>{
  it('offers models on another runner for shared projects while private projects stay on their runner',()=>{
    const app=new App({} as DomSanitizer);
    app.accounts.set([{id:'connection',provider:'codex',name:'My connection',runnerId:'my-runner',models:[{id:'runner-model',label:'Runner model'}],mode:'runner',auth:'ready',detail:'',limit:{source:'unknown',primary:null,secondary:null,cooldownUntil:null,updatedAt:null}}]);
    const project={id:'project',name:'Shared project',runnerId:'friend-runner',createdAt:'2026-09-30',updatedAt:'2026-09-30',shared:true};
    app.projects.set([project]);app.selectedProjectId.set(project.id);app.selectedService.set('codex');
    expect(app.hasAccountsFor('codex')).toBeTrue();
    expect(app.models().some(m=>m.id==='runner-model')).toBeTrue();
    app.projects.set([{...project,shared:false}]);
    expect(app.hasAccountsFor('codex')).toBeFalse();
    expect(app.models().some(m=>m.id==='runner-model')).toBeFalse();
  });
});
