import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
LucideBookOpen,
LucideCheck,
LucideCopy,
LucideInfo,
LucidePlus,
LucideServer,
LucideSettings2,
LucideTerminal,
LucideX,
LucideZap,
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';
import { ManagerPanel } from '../manager-panel';
@Component({
  selector: 'app-runners-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideInfo,
    LucideX,
    LucideServer,
    LucideSettings2,
    LucidePlus,
    LucideCheck,
    LucideCopy,
    LucideZap,
    LucideBookOpen,
    LucideTerminal,
    ManagerPanel,
  ],
  templateUrl: './runners-page.html',
  host: { style: 'display: contents' },
})
export class RunnersPageComponent {
  readonly vm = inject(WorkspaceStore);
}
