import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiService } from '../core/api.service';
import { GithubRunWidgetComponent } from './github-run-widget';

describe('Floating GitHub run', () => {
  const run = { id: 1, repository: 'team/app', title: 'Deploy update', name: 'Deploy', branch: 'main', status: 'in_progress', createdAt: '2026-10-20T10:00:00Z', url: 'https://github.com/team/app/actions/runs/1' };
  function setup() {
    const state = { connected: true, runs: [run], fail: false };
    const request = jasmine.createSpy('request').and.callFake(async (path: string) => {
      if (state.fail) throw new Error('Offline');
      if (path === '/github') return { connected: state.connected };
      if (path === '/github/runs') return { runs: state.runs };
      return { jobs: [{ id: 10, name: 'Build app', status: 'in_progress', steps: [{ number: 1, name: 'Compile', status: 'in_progress' }] }] };
    });
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ApiService, useValue: { request } }] });
    const fixture = TestBed.createComponent(GithubRunWidgetComponent);
    fixture.detectChanges(); flushMicrotasks(); fixture.detectChanges();
    return { fixture, widget: fixture.componentInstance, state, request };
  }
  it('shows the newest active run even when older runs are returned first', fakeAsync(() => {
    const { fixture, widget, state } = setup();
    state.runs = [run, { ...run, id: 2, title: 'Newest active', createdAt: '2026-10-20T11:00:00Z' }, { ...run, id: 3, status: 'completed', createdAt: '2026-10-20T12:00:00Z' }];
    void widget.refresh(); flushMicrotasks(); fixture.detectChanges();
    expect(widget.run()?.id).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Newest active');
    expect(fixture.nativeElement.textContent).not.toContain('Compile');
    fixture.nativeElement.querySelector('.summary-toggle').click(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Compile');
    expect(fixture.nativeElement.querySelector('.run-title').target).toBe('_blank');
    fixture.destroy();
  }));
  it('keeps a dismissed run hidden on refresh and shows a new run collapsed', fakeAsync(() => {
    const { fixture, widget, state } = setup();
    fixture.nativeElement.querySelector('[aria-label="Dismiss active run"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).toBeNull();
    tick(30000); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).toBeNull();
    state.runs = [{ ...run, id: 2 }];
    tick(30000); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).not.toBeNull();
    expect(widget.collapsed()).toBeTrue();
    fixture.destroy();
  }));
  it('switches to another active run then hides when all runs finish', fakeAsync(() => {
    const { fixture, widget, state } = setup();
    state.runs = [{ ...run, status: 'completed' }, { ...run, id: 2, createdAt: '2026-10-19T10:00:00Z' }];
    tick(30000); flushMicrotasks(); expect(widget.run()?.id).toBe(2);
    state.runs = state.runs.map(r => ({ ...r, status: 'completed' }));
    tick(30000); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).toBeNull();
    fixture.destroy();
  }));
  it('clears the card when GitHub is disconnected and stops polling on destroy', fakeAsync(() => {
    const { fixture, widget, state, request } = setup();
    state.connected = false;
    tick(30000); flushMicrotasks(); expect(widget.run()).toBeNull(); expect(widget.jobs()).toEqual([]);
    fixture.destroy(); const calls = request.calls.count(); tick(60000);
    expect(request.calls.count()).toBe(calls);
  }));
  it('marks cached status stale after a network failure and recovers', fakeAsync(() => {
    const { fixture, widget, state } = setup();
    state.fail = true; tick(30000); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Reconnecting');
    expect(widget.run()?.id).toBe(1);
    state.fail = false; tick(30000); flushMicrotasks(); expect(widget.stale()).toBeFalse();
    fixture.destroy();
  }));
  it('ignores responses received after the widget is destroyed', fakeAsync(() => {
    const { fixture, widget, request } = setup();
    let resolve!: (value: { connected: boolean }) => void;
    request.and.returnValue(new Promise(r => { resolve = r; }));
    void widget.refresh(); fixture.destroy(); resolve({ connected: true }); flushMicrotasks();
    expect(request.calls.mostRecent().args[0]).toBe('/github');
  }));
});
