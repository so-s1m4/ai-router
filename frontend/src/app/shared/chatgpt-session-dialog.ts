import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LucideCheck,LucideGlobe2,LucideX } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';
@Component({
  selector: 'app-chatgpt-session-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideGlobe2, LucideX, LucideCheck],
  templateUrl: './chatgpt-session-dialog.html',
  host: { style: 'display:contents' },
})
export class ChatgptSessionDialogComponent {
  readonly vm = inject(WorkspaceStore);
}
