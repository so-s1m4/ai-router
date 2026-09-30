import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, inject, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucidePlus, LucideX } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-add-account-form',
  standalone: true,
  imports: [CommonModule, FormsModule, LucidePlus, LucideX],
  templateUrl: './add-account-form.html',
  host: { style: 'display: contents' },
})
export class AddAccountFormComponent implements AfterViewInit {
  readonly vm = inject(WorkspaceStore);
  @Output() closed = new EventEmitter<void>();
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;

  ngAfterViewInit() {
    this.dialog.nativeElement.showModal();
  }

  close() {
    this.dialog.nativeElement.close();
    this.closed.emit();
  }

  async submit() {
    if (await this.vm.accountService.addAccount()) this.close();
  }
}
