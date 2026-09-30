import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
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
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-chat-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideX,
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
  host: { style: 'display: contents' },
})
export class ChatSidebarComponent {
  readonly vm = inject(WorkspaceStore);
}
