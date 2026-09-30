import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { LucideX } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-usage-page',
  standalone: true,
  imports: [CommonModule, LucideX],
  templateUrl: './usage-page.html',
  host: { style: 'display: contents' },
})
export class UsagePageComponent {
  readonly vm = inject(WorkspaceStore);
}
