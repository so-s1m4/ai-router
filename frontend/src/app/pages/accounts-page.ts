import { CommonModule } from '@angular/common';
import { Component,inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
LucideCheck,
LucideCopy,
LucideInfo,
LucidePlugZap,
LucidePlus,
LucideRefreshCw,
LucideTerminal,
LucideX,
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';
import { AccountCardComponent } from '../shared/account-card';
import { AddAccountFormComponent } from '../shared/add-account-form';
import { ChatgptSessionDialogComponent } from '../shared/chatgpt-session-dialog';
import { SharedAccessComponent } from '../shared/shared-access';
@Component({
  selector: 'app-accounts-page',
  standalone: true,
  imports: [
    ChatgptSessionDialogComponent,
    CommonModule,
    FormsModule,
    LucidePlus,
    LucideRefreshCw,
    LucideInfo,
    LucideX,
    LucidePlugZap,
    LucideTerminal,
    LucideCheck,
    LucideCopy,

    AccountCardComponent,
    AddAccountFormComponent,
    SharedAccessComponent,
  ],
  templateUrl: './accounts-page.html',
  host: { style: 'display: contents' },
})
export class AccountsPageComponent {
  readonly vm = inject(WorkspaceStore);
}
