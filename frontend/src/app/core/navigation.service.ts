import { Injectable, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';
export const PAGE_PATHS = {
  chat: 'chats',
  files: 'files',
  operations: 'usage',
  notifications: 'notifications',
  projects: 'projects',
  sites: 'sites',
  providers: 'models',
  cccAuto: 'ccc-auto',
  connections: 'accounts',
  users: 'users',
  runners: 'runners',
} as const;
export type PageId = keyof typeof PAGE_PATHS;
@Injectable({ providedIn: 'root' })
export class NavigationService {
  readonly page = signal<PageId>('projects');
  private subscription?: Subscription;
  constructor(private router: Router) {}
  navigate(page: PageId) {
    void this.router.navigate(['/', PAGE_PATHS[page]], {
      queryParams: { session: null },
      queryParamsHandling: 'merge',
    });
  }
  navigateChat(session?: string) {
    void this.router.navigate(['/chats'], {
      queryParams: { session: session || null },
      queryParamsHandling: 'merge',
    });
  }
  onPageChange(callback: (page: PageId) => void) {
    this.stop();
    const sync = () => {
      const path = this.router.url.split(/[?#]/)[0].split('/')[1];
      const page =
        (Object.keys(PAGE_PATHS) as PageId[]).find((id) => PAGE_PATHS[id] === path) || 'projects';
      this.page.set(page);
      callback(page);
    };
    this.subscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(sync);
    sync();
  }
  stop() {
    this.subscription?.unsubscribe();
  }
}
