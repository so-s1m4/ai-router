import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideFile,LucideFolderOpen,LucideTrash2 } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-files-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideFile, LucideTrash2, LucideFolderOpen],
  templateUrl: './files-page.html',
  host: { style: 'display: contents' },
})
export class FilesPageComponent {
  readonly vm = inject(WorkspaceStore);
}
