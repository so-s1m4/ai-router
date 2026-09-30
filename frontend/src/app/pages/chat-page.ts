import { CommonModule } from '@angular/common';
import { AfterViewInit,Component,ElementRef,inject,OnDestroy,ViewChild } from '@angular/core';
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
  host: { style: 'display: contents' },
})
export class ChatPageComponent implements AfterViewInit, OnDestroy {
  readonly vm = inject(WorkspaceStore);
  @ViewChild('chatScrollArea') set scroll(ref: ElementRef<HTMLDivElement> | undefined) {
    this.vm.chatViewService.chatScrollArea = ref;
  }
  @ViewChild('messageFeed') set feed(ref: ElementRef<HTMLDivElement> | undefined) {
    this.vm.chatViewService.messageFeed = ref;
    this.vm.chatViewService.ensureChatScrollAttached();
  }
  ngAfterViewInit() {
    this.vm.chatViewService.ngAfterViewInit();
  }
  ngOnDestroy() {
    this.vm.chatViewService.detachChatView();
  }
}
