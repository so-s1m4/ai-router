import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
  LucideFolder,
  LucideSearch,
  LucideArrowUpRight,
  LucideInfo,
  LucideMessageSquare,
  LucidePlus,
  LucideServer,
  LucideX,
  LucideTrash2,
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-projects-page',
  standalone: true,
  imports: [
    CommonModule,
    LucideSearch,
    LucideArrowUpRight,
    LucideInfo,
    LucideX,
    LucideTrash2,
    LucideFolder,
    LucidePlus,
    LucideServer,
    LucideMessageSquare,
  ],
  templateUrl: './projects-page.html',
  styleUrl: './projects-page.css',
  host: { style: 'display: contents' },
})
export class ProjectsPageComponent {
  readonly vm = inject(WorkspaceStore);
  readonly query = signal('');
  readonly sort = signal('recent');
  readonly projects = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    const projects = this.vm.projectService.projects().filter((project) =>
      project.name.toLocaleLowerCase().includes(query),
    );
    return projects.sort((a, b) => {
      if (this.sort() === 'name') return a.name.localeCompare(b.name);
      const aTime = this.vm.chatsFor(a.id)[0]?.updatedAt || a.updatedAt;
      const bTime = this.vm.chatsFor(b.id)[0]?.updatedAt || b.updatedAt;
      return (Date.parse(bTime) || 0) - (Date.parse(aTime) || 0) || a.name.localeCompare(b.name);
    });
  });
}
