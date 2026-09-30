import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideBot,LucideCheck,LucideSearch,LucideX } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-model-picker-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideX, LucideSearch, LucideBot, LucideCheck],
  templateUrl: './model-picker-dialog.html',
  host: { style: 'display: contents' },
})
export class ModelPickerDialogComponent {
  readonly vm = inject(WorkspaceStore);
}
