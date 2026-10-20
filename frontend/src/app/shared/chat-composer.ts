import { VoiceInputService } from '../core/voice-input.service';
import { CommonModule } from '@angular/common';
import { Component,ElementRef,inject,Input,OnDestroy,ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModelControlsComponent } from '../shared/model-controls';

import { LucideArrowUp,LucidePlus,LucideSquare,LucideMic } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';
@Component({
  selector: 'app-chat-composer',
  standalone: true,
  imports: [
    ModelControlsComponent,
    CommonModule,
    FormsModule,
    LucidePlus,
    LucideMic,
    LucideSquare,
    LucideArrowUp,
  ],
  templateUrl: './chat-composer.html',
  styleUrl: './chat-composer.css',
  providers: [VoiceInputService],
  host: { style: 'display:contents' },
})
export class ChatComposerComponent implements OnDestroy {
  readonly vm = inject(WorkspaceStore);
  readonly voice = inject(VoiceInputService);
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
    if (chat.canceling() || this.voice.busy) return true;
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
  toggleVoice() {
    if (this.voice.busy) { void this.voice.stop(); return; }
    void this.voice.start(text => {
      const draft = this.vm.chatService.draft;
      this.vm.chatService.draft = draft + (draft && !/\s$/.test(draft) ? ' ' : '') + text;
      setTimeout(() => this.resize());
    });
  }
  composerKey(event: KeyboardEvent) {
    if (this.voice.busy && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); return; }
    this.vm.chatService.onComposerEnter(event);
  }
  resize() {
    if (this.hero) this.vm.chatViewService.adjustHeroTextareaHeight();
    else this.vm.chatViewService.adjustTextareaHeight();
  }
  ngOnDestroy() {
    this.voice.cancel();
    if (this.hero) this.vm.chatViewService.heroComposerTextareaRef = undefined;
    else this.vm.chatViewService.composerTextareaRef = undefined;
  }
}
