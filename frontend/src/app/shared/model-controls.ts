import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LucideChevronDown } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';
@Component({
  selector: 'app-model-controls',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideChevronDown],
  templateUrl: './model-controls.html',
  host: { class: 'pill-controls' },
})
export class ModelControlsComponent {
  readonly vm = inject(WorkspaceStore);
}
