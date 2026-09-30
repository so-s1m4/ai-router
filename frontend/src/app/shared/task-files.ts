import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import {
LucideChevronDown,
LucideChevronRight,
LucideCopy,
LucideDownload,
LucideFile,
LucideFolder,
LucideFolderOpen,
LucideRefreshCw,
LucideSearch,
LucideTrash2,
LucideX,
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-task-files',
  standalone: true,
  imports: [
    CommonModule,
    LucideRefreshCw,
    LucideSearch,
    LucideX,
    LucideChevronDown,
    LucideChevronRight,
    LucideFolderOpen,
    LucideFolder,
    LucideFile,
    LucideDownload,
    LucideCopy,
    LucideTrash2,
  ],
  templateUrl: './task-files.html',
  host: { style: 'display: contents' },
})
export class TaskFilesComponent {
  readonly vm = inject(WorkspaceStore);
}
