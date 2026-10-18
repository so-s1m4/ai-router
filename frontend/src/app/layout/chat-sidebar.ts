import { InstallAppComponent } from '../shared/install-app';
import { CommonModule } from '@angular/common';
import { Component, effect, HostListener, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideChevronRight,
  LucideEllipsis,
  LucideBell,
  LucideBot,
  LucideFile,
  LucideFolder,
  LucideFolderOpen,
  LucideGlobe2,
  LucideGraduationCap,
  LucideLogOut,
  LucideMessageSquare,
  LucideOrigami,
  LucidePlugZap,
  LucidePlus,
  LucideSearch,
  LucideServer,
  LucideSettings2,
  LucideSquarePen,
  LucideTerminal,
  LucideX,
  LucideTrash2,
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-chat-sidebar',
  standalone: true,
  imports: [
    InstallAppComponent,
    CommonModule,
    FormsModule,
    LucideChevronRight,
    LucideEllipsis,
    LucideX,
    LucideTrash2,
    LucideSearch,
    LucideSquarePen,
    LucideMessageSquare,
    LucideFolder,
    LucideTerminal,
    LucideFile,
    LucideGlobe2,
    LucideBot,
    LucidePlugZap,
    LucideServer,
    LucideBell,
    LucideSettings2,
    LucidePlus,
    LucideGraduationCap,
    LucideOrigami,
    LucideFolderOpen,
    LucideLogOut,
  ],
  templateUrl: './chat-sidebar.html',
  styleUrl: './chat-sidebar.css',
  host: { style: 'display: contents' },
})
export class ChatSidebarComponent {
  readonly vm = inject(WorkspaceStore);
  readonly openActions = signal<string | null>(null);
  readonly fullProjects = signal(new Set<string>());

  constructor() {
    effect(() => {
      const projectId = this.vm.sessionService.current()?.projectId;
      if (projectId) {
        this.vm.layoutService.expandedProjects.update(ids => new Set([...ids, projectId]));
      }
      this.openActions.set(null);
    });
  }

  toggleAllChats(projectId: string) {
    this.fullProjects.update(ids => {
      const next = new Set(ids);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  @HostListener('document:click', ['$event'])
  closeActionsOutside(event: MouseEvent) {
    if (!(event.target instanceof Element) || !event.target.closest('.sidebar-chat-actions')) {
      this.openActions.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  closeActions() {
    const id = this.openActions();
    this.openActions.set(null);
    if (id) document.getElementById('chat-actions-' + id)?.focus();
  }

  deleteChat(id: string) {
    this.openActions.set(null);
    void this.vm.chatService.deleteSession(id);
  }
}
