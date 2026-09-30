import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import {
LucideBell,
LucideBot,
LucideCircleQuestionMark,
LucideFile,
LucideFolder,
LucideGlobe2,
LucideLogOut,
LucideMessageSquare,
LucidePlugZap,
LucideServer,
LucideSettings2,
LucideTerminal,
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-navigation-rail',
  standalone: true,
  imports: [
    CommonModule,
    LucideMessageSquare,
    LucideFolder,
    LucideTerminal,
    LucideFile,
    LucideGlobe2,
    LucideBot,
    LucidePlugZap,
    LucideServer,
    LucideBell,
    LucideSettings2,
    LucideCircleQuestionMark,
    LucideLogOut,
  ],
  templateUrl: './navigation-rail.html',
  host: { style: 'display: contents' },
})
export class NavigationRailComponent {
  readonly vm = inject(WorkspaceStore);
}
