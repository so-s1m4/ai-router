import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LucideFolder,LucideGlobe2,LucideMenu,LucideSquarePen } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';
import { ChatSidebarComponent } from '../layout/chat-sidebar';
import { NavigationRailComponent } from '../layout/navigation-rail';
import { PageHeaderComponent } from '../layout/page-header';
@Component({
  selector: 'app-workspace-shell',
  standalone: true,
  imports: [
    CommonModule,
    LucideFolder,
    LucideGlobe2,
    LucideSquarePen,
    LucideMenu,
    RouterOutlet,
    NavigationRailComponent,
    ChatSidebarComponent,
    PageHeaderComponent,
  ],
  templateUrl: './workspace-shell.html',
  host: { style: 'display: contents' },
})
export class WorkspaceShellComponent {
  readonly vm = inject(WorkspaceStore);
}
