import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import {
LucideFolder,
LucideInfo,
LucideMessageSquare,
LucidePlus,
LucideServer,
LucideX,
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-projects-page',
  standalone: true,
  imports: [
    CommonModule,
    LucideInfo,
    LucideX,
    LucideFolder,
    LucidePlus,
    LucideServer,
    LucideMessageSquare,
  ],
  templateUrl: './projects-page.html',
  host: { style: 'display: contents' },
})
export class ProjectsPageComponent {
  readonly vm = inject(WorkspaceStore);
}
