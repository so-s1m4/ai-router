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
  resize() {
    if (this.hero) this.vm.chatViewService.adjustHeroTextareaHeight();
    else this.vm.chatViewService.adjustTextareaHeight();
  }
  ngOnDestroy() {
    if (this.hero) this.vm.chatViewService.heroComposerTextareaRef = undefined;
    else this.vm.chatViewService.composerTextareaRef = undefined;
  }
}
