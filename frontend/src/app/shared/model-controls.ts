import { CommonModule } from '@angular/common';
import { Component, ElementRef, inject, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LucideChevronDown, LucideSlidersHorizontal } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';
@Component({
  selector: 'app-model-controls',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideChevronDown, LucideSlidersHorizontal],
  templateUrl: './model-controls.html',
  host: { class: 'pill-controls' },
})
export class ModelControlsComponent {
  readonly vm = inject(WorkspaceStore);
  @ViewChild('configuration') configuration!: ElementRef<HTMLDialogElement>;
  openConfiguration() {
    const dialog = this.configuration.nativeElement;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('h2')?.focus();
  }
  resetConfiguration() {
    const models = this.vm.modelService;
    models.workflow.set('standard');
    models.selectService('auto');
    models.selectModel('auto');
    models.onReasoningChange('default');
    models.codexFast.set(false);
  }
  closeOnBackdrop(event: MouseEvent) {
    const dialog = this.configuration.nativeElement;
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }
}
