import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { firstValueFrom, filter } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, NavigationEnd } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Location } from '@angular/common';
import { routes } from './app.routes';
import { ApiService } from './core/api.service';
import { AuthService } from './core/auth.service';
import { NavigationService } from './core/navigation.service';
import { WorkspaceStore } from './core/workspace.store';
import { ChatViewService } from './core/chat-view.service';

describe('Workspace routing', () => {
  let navigation: NavigationService;
  let workspace: WorkspaceStore;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes), provideLocationMocks()] });
    TestBed.inject(Router).setUpLocationChangeListener();
    const auth = TestBed.inject(AuthService);
    auth.loggedIn.set(true);
    auth.isOwner.set(true);
    spyOn(TestBed.inject(ApiService), 'request').and.resolveTo([]);
    workspace = TestBed.inject(WorkspaceStore);
    navigation = TestBed.inject(NavigationService);
    navigation.onPageChange(() => {});
  });
  afterEach(() => {
    navigation.stop();
    TestBed.inject(ChatViewService).detachChatView();
  });

  it('opens every page through its URL', async () => {
    const harness = await RouterTestingHarness.create();
    for (const [path, selector, page] of [
      ['/projects', 'app-projects-page', 'projects'],
      ['/chats', 'app-chat-page', 'chat'],
      ['/files', 'app-files-page', 'files'],
      ['/usage', 'app-usage-page', 'operations'],
      ['/accounts', 'app-accounts-page', 'connections'],
      ['/models', 'app-models-page', 'providers'],
      ['/runners', 'app-runners-page', 'runners'],
      ['/sites', 'app-sites-page', 'sites'],
      ['/notifications', 'app-notifications-page', 'notifications'],
      ['/users', 'app-users-page', 'users'],
    ]) {
      await harness.navigateByUrl(path);
      expect(harness.routeNativeElement?.tagName.toLowerCase()).toBe(selector);
      expect(navigation.page()).toBe(page);
    }
  });

  it('keeps the chat draft and session while switching pages and going back', async () => {
    const harness = await RouterTestingHarness.create('/chats?session=chat');
    workspace.chatService.draft = 'Unsent message';
    workspace.sessionService.current.set({
      id: 'chat',
      title: 'My chat',
      messages: [],
      updatedAt: '2026-09-30',
    });
    const away = firstValueFrom(
      TestBed.inject(Router).events.pipe(filter((event) => event instanceof NavigationEnd)),
    );
    workspace.showPage('connections');
    await away;
    expect(TestBed.inject(Router).url).toBe('/accounts');
    const location = TestBed.inject(Location);
    const navigated = firstValueFrom(
      TestBed.inject(Router).events.pipe(filter((event) => event instanceof NavigationEnd)),
    );
    (location as SpyLocation).simulateUrlPop('/chats?session=chat');
    await navigated;
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/chats?session=chat');
    expect(navigation.page()).toBe('chat');
    expect(workspace.chatService.draft).toBe('Unsent message');
    expect(workspace.sessionService.current()?.id).toBe('chat');
  });

  it('redirects a non-owner away from the users URL', async () => {
    TestBed.inject(AuthService).isOwner.set(false);
    const harness = await RouterTestingHarness.create('/users');
    expect(TestBed.inject(Router).url).toBe('/projects');
    expect(harness.routeNativeElement?.tagName.toLowerCase()).toBe('app-projects-page');
  });

  it('rebinds the composer after the first message replaces the welcome screen', async () => {
    const harness = await RouterTestingHarness.create('/chats');
    const view = TestBed.inject(ChatViewService);
    expect(view.heroComposerTextareaRef?.nativeElement).toBeTruthy();
    workspace.sessionService.current.set({
      id: 'chat',
      title: 'My chat',
      messages: [{ id: 'm', role: 'user', text: 'Hello' }],
      updatedAt: '2026-09-30',
    });
    harness.detectChanges();
    expect(view.heroComposerTextareaRef).toBeUndefined();
    expect(view.composerTextareaRef?.nativeElement).toBeTruthy();
    expect(view.messageFeed?.nativeElement).toBeTruthy();
    await harness.navigateByUrl('/projects');
    expect(view.composerTextareaRef).toBeUndefined();
    expect(view.chatScrollArea).toBeUndefined();
  });
});
