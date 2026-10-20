import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { ApiService } from '../core/api.service';
import { GithubPageComponent } from './github-page';

describe('GitHub Actions page',()=>{
  const repo={id:1,full_name:'team/private-app',private:true};
  const run={id:123,repository:repo.full_name,name:'Deploy',title:'Release update',branch:'main',sha:'abcd123',status:'in_progress',conclusion:null,url:'https://github.com/team/private-app/actions/runs/123',createdAt:'2026-10-19T12:00:00Z',updatedAt:'2026-10-19T12:00:00Z'};
  function setup(connected=true) {
    const request=jasmine.createSpy('request').and.callFake(async(path:string,options?:RequestInit)=>{
      if(path==='/github')return options?.method==='DELETE'?{ok:true}:{connected,login:connected?'tester':''};
      if(path==='/github/repositories')return [repo];
      if(path.startsWith('/github/runs'))return {runs:[run],errors:[],updatedAt:'2026-10-19T12:00:00Z'};
      if(path.endsWith('/jobs'))return {jobs:[{id:1,name:'Build and deploy',status:'in_progress',conclusion:null,steps:[{number:1,name:'Install',status:'completed',conclusion:'success'},{number:2,name:'Deploy',status:'in_progress',conclusion:null}]}]};
      throw new Error('Unexpected API path');
    });
    TestBed.configureTestingModule({providers:[{provide:ApiService,useValue:{request}}]});
    const fixture=TestBed.createComponent(GithubPageComponent);
    fixture.detectChanges();flushMicrotasks();fixture.detectChanges();
    return {fixture,page:fixture.componentInstance,request};
  }
  it('renders workflows, expands actual step progress, and filters results',fakeAsync(()=>{
    const {fixture,page}=setup();
    expect(fixture.nativeElement.textContent).toContain('team/private-app');
    expect(fixture.nativeElement.textContent).toContain('In progress');
    fixture.nativeElement.querySelector('.run-summary').click();flushMicrotasks();fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1/2 steps');
    expect(fixture.nativeElement.querySelector('progress').value).toBe(1);
    expect(fixture.nativeElement.querySelector('progress').max).toBe(2);
    page.query.set('absent');fixture.detectChanges();expect(fixture.nativeElement.querySelector('.run')).toBeNull();
    page.query.set('main');fixture.detectChanges();expect(fixture.nativeElement.querySelector('.run')).not.toBeNull();
    fixture.destroy();
  }));
  it('collapses successful jobs and opens failed jobs with readable step statuses',fakeAsync(()=>{
    const {fixture,page}=setup();
    fixture.nativeElement.querySelector('.run-summary').click();flushMicrotasks();
    page.jobs.set([
      {id:1,name:'Build',status:'completed',conclusion:'success',steps:[{number:1,name:'Compile',status:'completed',conclusion:'success'}]},
      {id:2,name:'Deploy',status:'completed',conclusion:'failure',steps:[{number:1,name:'Upload',status:'completed',conclusion:'failure'}]},
    ]);
    fixture.detectChanges();
    const jobs=fixture.nativeElement.querySelectorAll('details.job');
    expect(jobs[0].open).toBeFalse();
    expect(jobs[1].open).toBeTrue();
    expect(jobs[1].querySelector('.step-failed').textContent).toContain('Failed');
    jobs[0].querySelector('summary').click();
    expect(jobs[0].open).toBeTrue();
    fixture.destroy();
  }));
  it('shows connection setup and explains required permissions',fakeAsync(()=>{
    const {fixture}=setup(false);
    expect(fixture.nativeElement.querySelector('input[type=password]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Actions: Read-only');
    expect(fixture.nativeElement.querySelector('.run')).toBeNull();
    fixture.destroy();
  }));
  it('clears cached workflows and account details on disconnect',fakeAsync(()=>{
    const {fixture,page,request}=setup();
    void page.disconnect();flushMicrotasks();fixture.detectChanges();
    expect(request).toHaveBeenCalledWith('/github',{method:'DELETE'});
    expect(page.connected()).toBeFalse();expect(page.runs()).toEqual([]);expect(page.login()).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain('Release update');
    fixture.destroy();
  }));
});
