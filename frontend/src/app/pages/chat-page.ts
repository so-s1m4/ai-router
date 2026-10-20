import { CommonModule } from '@angular/common';
import { AfterViewInit,computed,Component,ElementRef,inject,OnDestroy,ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
LucideChevronDown,
LucideCopy,
LucideFolder,
LucideInfo,
LucideRotateCcw,
LucideSparkles,
LucideUploadCloud,
LucideX,
} from '@lucide/angular';
import { Message } from '../core/models';
import { WorkspaceStore } from '../core/workspace.store';
import { MarkdownPipe } from '../markdown.pipe';
import { ChatComposerComponent } from '../shared/chat-composer';
import { TaskFilesComponent } from '../shared/task-files';
@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [
    ChatComposerComponent,
    CommonModule,
    FormsModule,
    MarkdownPipe,
    LucideUploadCloud,
    LucideInfo,
    LucideX,
    LucideFolder,

    LucideChevronDown,
    LucideSparkles,
    LucideCopy,
    LucideRotateCcw,

    TaskFilesComponent,
  ],
  templateUrl: './chat-page.html',
  styleUrl: './chat-page.css',
  host: { style: 'display: contents' },
})
export class ChatPageComponent implements AfterViewInit, OnDestroy {
  readonly vm = inject(WorkspaceStore);
  readonly turns = computed(() => {
    const turns: { id: string; message: Message; progress: Message[]; runId?: string }[] = [];
    for (const message of this.vm.chatService.history()) {
      const last = turns.at(-1);
      if (message.role === 'user' || !last || last.message.role === 'user' ||
          !message.runId || last.runId !== message.runId) {
        turns.push({ id: message.id, message, progress: [], runId: message.runId });
      } else if (message.kind === 'activity') {
        last.progress.push(message);
      } else {
        if (last.message.kind !== 'activity') last.progress.push(last.message);
        else last.progress.unshift(last.message);
        last.message = message;
      }
    }
    // Activities preceding the first text belong in the same disclosure.
    const order = new Map(this.vm.chatService.history().map((row, index) => [row.id, index]));
    for (const turn of turns) turn.progress.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return turns;
  });
  readonly liveTurn = computed(() => this.vm.chatService.running()
    ? [...this.turns()].reverse().find(turn => turn.runId === this.vm.chatService.runId() && turn.message.role !== 'user')
    : undefined);
  @ViewChild('chatScrollArea') set scroll(ref: ElementRef<HTMLDivElement> | undefined) {
    this.vm.chatViewService.chatScrollArea = ref;
  }
  @ViewChild('messageFeed') set feed(ref: ElementRef<HTMLDivElement> | undefined) {
    this.vm.chatViewService.messageFeed = ref;
    this.vm.chatViewService.ensureChatScrollAttached();
  }
  usePrompt(prompt: string) {
    this.vm.chatService.draft = prompt;
    const textarea = document.querySelector<HTMLTextAreaElement>('.pill-textarea');
    if (textarea) {
      textarea.value = prompt;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
    }
  }
  ngAfterViewInit() {
    this.vm.chatViewService.ngAfterViewInit();
  }
  ngOnDestroy() {
    this.vm.chatViewService.detachChatView();
  }
}
