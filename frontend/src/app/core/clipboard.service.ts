import { inject, Injectable, signal } from '@angular/core';
import { FeedbackService } from './feedback.service';

@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly feedback = inject(FeedbackService);
  readonly notice = this.feedback.notice;

  copiedId = signal<string>('');
  async copy(text: string, id: string = '') {
    await navigator.clipboard.writeText(text);
    if (id) {
      this.copiedId.set(id);
      setTimeout(() => {
        if (this.copiedId() === id) this.copiedId.set('');
      }, 2000);
    }
    this.notice.set('Copied to clipboard');
  }
  handleChatClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const copyBtn = target.closest('.copy-code-btn') as HTMLButtonElement | null;
    if (!copyBtn) return;

    event.preventDefault();
    event.stopPropagation();

    const codeBlock = copyBtn.closest('.code-block');
    const codeEl = codeBlock?.querySelector('pre code');
    const codeText = codeEl?.textContent || '';
    if (!codeText) return;

    navigator.clipboard
      .writeText(codeText)
      .then(() => {
        copyBtn.classList.add('copied');
        const label = copyBtn.querySelector('.copy-label');
        if (label) label.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          if (label) label.textContent = 'Copy';
        }, 2000);
        this.notice.set('The code has been copied to the clipboard');
      })
      .catch(() => {
        this.notice.set('Failed to copy code');
      });
  }
}
