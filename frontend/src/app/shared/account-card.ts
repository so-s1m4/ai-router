import { CommonModule } from '@angular/common';
import { Component,inject,Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
LucideBot,
LucideCheck,
LucideClock,
LucideCopy,
LucideGlobe2,
LucideKey,
LucideRotateCcw,
LucideSparkles,
LucideTerminal,
LucideTrash2,
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-account-card',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideKey,
    LucideBot,
    LucideSparkles,
    LucideGlobe2,
    LucideTrash2,
    LucideRotateCcw,
    LucideClock,
    LucideTerminal,
    LucideCheck,
    LucideCopy,
  ],
  templateUrl: './account-card.html',
  host: { style: 'display: contents' },
})
export class AccountCardComponent {
  readonly vm = inject(WorkspaceStore);
  @Input({ required: true }) a!: import('../core/models').Account;
}
