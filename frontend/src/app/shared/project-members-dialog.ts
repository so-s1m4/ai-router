import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideFolder,LucideX } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-project-members-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideFolder, LucideX],
  templateUrl: './project-members-dialog.html',
  host: { style: 'display: contents' },
})
export class ProjectMembersDialogComponent {
  readonly vm = inject(WorkspaceStore);
}
