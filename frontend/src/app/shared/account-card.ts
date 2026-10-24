import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { LucideBot, LucideChevronRight, LucideGlobe2, LucideKey, LucideTrash2, LucideSparkles } from '@lucide/angular';
import { Account } from '../core/models';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-account-card',
  standalone: true,
  imports: [LucideBot, LucideChevronRight, LucideGlobe2, LucideKey, LucideTrash2, LucideSparkles],
  templateUrl: './account-card.html',
  styles: [`.account-list-entry { display: flex; align-items: center; gap: 8px; } .account-list-entry .account-inline-row { flex: 1; min-width: 0; }`],
  host: { style: 'display: contents' },
})
export class AccountCardComponent {
  readonly vm = inject(WorkspaceStore);
  @Input({ required: true }) a!: Account;
  @Output() details = new EventEmitter<Account>();
}
