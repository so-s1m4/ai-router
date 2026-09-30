import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  mobileMenu = signal(false);
  sidebarOpen = signal(true);
  expandedProjects = signal<Set<string>>(
    new Set(['CCC-Solutions', 'Quest Control', 'proj-ccc', 'proj-quest']),
  );
  userMenuOpen = signal(false);
  helpModalOpen = signal(false);
  searchOpen = signal(false);
  sidebarSearch = signal('');
  toggleSidebar() {
    this.sidebarOpen.update((v) => !v);
  }
  toggleProjectExpand(nameOrId: string) {
    this.expandedProjects.update((set) => {
      const next = new Set(set);
      if (next.has(nameOrId)) next.delete(nameOrId);
      else next.add(nameOrId);
      return next;
    });
  }
}
