import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucidePlus,LucideRefreshCw } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-shared-access',
  standalone: true,
  imports: [CommonModule, FormsModule, LucidePlus, LucideRefreshCw],
  templateUrl: './shared-access.html',
  host: { style: 'display: contents' },
})
export class SharedAccessComponent {
  readonly vm = inject(WorkspaceStore);
}
