import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { LucideBot, LucideChevronRight, LucideGlobe2, LucideKey, LucideSparkles } from '@lucide/angular';
import { Account } from '../core/models';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-account-card',
  standalone: true,
  imports: [LucideBot, LucideChevronRight, LucideGlobe2, LucideKey, LucideSparkles],
  templateUrl: './account-card.html',
  host: { style: 'display: contents' },
})
export class AccountCardComponent {
  readonly vm = inject(WorkspaceStore);
  @Input({ required: true }) a!: Account;
  @Output() details = new EventEmitter<Account>();
}
