import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import {
LucideDownload,
LucideMenu,
LucidePanelLeft,
LucidePlus,
LucideRefreshCw,
LucideRotateCcw,
LucideSquarePen,
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [
    CommonModule,
    LucidePanelLeft,
    LucideMenu,
    LucideSquarePen,
    LucideDownload,
    LucideRotateCcw,
    LucidePlus,
    LucideRefreshCw,
  ],
  templateUrl: './page-header.html',
  host: { style: 'display: contents' },
})
export class PageHeaderComponent {
  readonly vm = inject(WorkspaceStore);
}
