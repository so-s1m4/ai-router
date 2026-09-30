import { CommonModule } from '@angular/common';
import { Component,HostListener,inject } from '@angular/core';
import { LucideX } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-file-preview-dialog',
  standalone: true,
  imports: [CommonModule, LucideX],
  templateUrl: './file-preview-dialog.html',
  host: { style: 'display: contents' },
})
export class FilePreviewDialogComponent {
  readonly vm = inject(WorkspaceStore);
  @HostListener('document:keydown', ['$event']) onKey(event: KeyboardEvent) {
    this.vm.filePreviewService.onPreviewKey(event);
  }
}
