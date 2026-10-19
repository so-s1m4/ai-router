import { CommonModule } from '@angular/common';
import { Component,ElementRef,inject,Input,OnDestroy,ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModelControlsComponent } from '../shared/model-controls';

import { LucideArrowUp,LucidePlus,LucideSquare } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';
@Component({
  selector: 'app-chat-composer',
  standalone: true,
  imports: [
    ModelControlsComponent,
    CommonModule,
    FormsModule,
    LucidePlus,
    LucideSquare,
    LucideArrowUp,
  ],
  templateUrl: './chat-composer.html',
  host: { style: 'display:contents' },
})
export class ChatComposerComponent implements OnDestroy {
  readonly vm = inject(WorkspaceStore);
  @Input() hero = false;
  @ViewChild('textarea') set textarea(ref: ElementRef<HTMLTextAreaElement> | undefined) {
    if (this.hero) this.vm.chatViewService.heroComposerTextareaRef = ref;
    else this.vm.chatViewService.composerTextareaRef = ref;
  }
  get stopAction(): boolean {
    return this.vm.chatService.running() && !this.vm.chatService.draft.trim();
  }
  get actionLabel(): string {
    const chat = this.vm.chatService;
    if (chat.canceling()) return 'Stopping…';
    if (this.stopAction) return 'Stop task';
    if (chat.steeringSending() || chat.taskSubmitting()) return 'Sending…';
    if (chat.running()) {
      return chat.steeringAvailable()
        ? 'Clarify the current task'
        : 'Clarification is unavailable for this task';
    }
    return 'Send';
  }
  get actionDisabled(): boolean {
    const chat = this.vm.chatService;
    if (chat.canceling()) return true;
    if (this.stopAction) return false;
    return !chat.draft.trim() || this.vm.filesService.uploading() ||
      chat.taskSubmitting() || chat.steeringSending() ||
      (chat.running() && !chat.steeringAvailable());
  }
  performAction() {
    if (this.actionDisabled) return;
    if (this.stopAction) void this.vm.chatService.cancel();
    else void this.vm.chatService.send();
  }
  resize() {
    if (this.hero) this.vm.chatViewService.adjustHeroTextareaHeight();
    else this.vm.chatViewService.adjustTextareaHeight();
  }
  ngOnDestroy() {
    if (this.hero) this.vm.chatViewService.heroComposerTextareaRef = undefined;
    else this.vm.chatViewService.composerTextareaRef = undefined;
  }
}
