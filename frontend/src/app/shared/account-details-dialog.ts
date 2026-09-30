import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, inject, Input, Output, EventEmitter, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBot,
  LucideCheck,
  LucideClock,
  LucideCopy,
  LucideGlobe2,
  LucideKey,
  LucideRotateCcw,
  LucideSparkles,
  LucideTerminal,
  LucideTrash2,
  LucideX,
} from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-account-details-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideKey,
    LucideBot,
    LucideSparkles,
    LucideGlobe2,
    LucideTrash2,
    LucideX,
    LucideRotateCcw,
    LucideClock,
    LucideTerminal,
    LucideCheck,
    LucideCopy,
  ],
  templateUrl: './account-details-dialog.html',
  host: { style: 'display: contents' },
})
export class AccountDetailsDialogComponent implements AfterViewInit {
  readonly vm = inject(WorkspaceStore);
  @Input({ required: true }) a!: import('../core/models').Account;
  @Output() closed = new EventEmitter<void>();
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;

  ngAfterViewInit() {
    this.dialog.nativeElement.showModal();
  }

  close() {
    this.dialog.nativeElement.close();
    this.closed.emit();
  }

  openSession() {
    this.close();
    this.vm.openChatGPTSessionModal(this.a);
  }
}
