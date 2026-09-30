import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { LucideGlobe2,LucideInfo,LucideServer,LucideX } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-sites-page',
  standalone: true,
  imports: [CommonModule, LucideInfo, LucideX, LucideGlobe2, LucideServer],
  templateUrl: './sites-page.html',
  host: { style: 'display: contents' },
})
export class SitesPageComponent {
  readonly vm = inject(WorkspaceStore);
}
