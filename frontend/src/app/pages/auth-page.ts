import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideArrowUpRight,LucideInfo,LucideSparkles } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideSparkles, LucideInfo, LucideArrowUpRight],
  templateUrl: './auth-page.html',
  host: { style: 'display: contents' },
})
export class AuthPageComponent {
  readonly vm = inject(WorkspaceStore);
}
