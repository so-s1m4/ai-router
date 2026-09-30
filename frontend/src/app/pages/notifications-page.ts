import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notifications-page.html',
  host: { style: 'display: contents' },
})
export class NotificationsPageComponent {
  readonly vm = inject(WorkspaceStore);
}
