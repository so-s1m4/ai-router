import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-users-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './users-page.html',
  host: { style: 'display: contents' },
})
export class UsersPageComponent {
  readonly vm = inject(WorkspaceStore);
}
