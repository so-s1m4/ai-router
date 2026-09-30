import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucidePlus } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-add-account-form',
  standalone: true,
  imports: [CommonModule, FormsModule, LucidePlus],
  templateUrl: './add-account-form.html',
  host: { style: 'display: contents' },
})
export class AddAccountFormComponent {
  readonly vm = inject(WorkspaceStore);
}
