import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
LucideBot,
LucideCheck,
LucideGlobe2,
LucideInfo,
LucideSearch,
LucideSparkles,
LucideX,
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-models-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideInfo,
    LucideX,
    LucideSearch,
    LucideCheck,
    LucideSparkles,
    LucideBot,
    LucideGlobe2,
  ],
  templateUrl: './models-page.html',
  host: { style: 'display: contents' },
})
export class ModelsPageComponent {
  readonly vm = inject(WorkspaceStore);
}
