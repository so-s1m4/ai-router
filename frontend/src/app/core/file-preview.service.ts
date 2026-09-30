import { inject, Injectable, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ApiService } from './api.service';
import { SessionsService } from './sessions.service';
@Injectable({ providedIn: 'root' })
export class FilePreviewService {
  private readonly http = inject(ApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly sessionService = inject(SessionsService);
  previewOpen = signal(false);
  previewLoading = signal(false);
  previewName = signal('');
  previewError = signal('');
  previewText = signal('');
  previewKind = signal('');
  previewUrl = signal('');
  previewPdf = signal<SafeResourceUrl | null>(null);
  previewRequest = 0;
  previewReturnFocus?: HTMLElement;
  onPreviewKey(event: KeyboardEvent) {
    if (!this.previewOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closePreview();
      return;
    }
    if (event.key === 'Tab') {
      const dialog = document.querySelector<HTMLElement>('.file-preview-dialog');
      const items = dialog?.querySelectorAll<HTMLElement>('button, iframe, [tabindex="0"]');
      if (!items?.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  async previewFile(
    name: string,
    kind: 'projects' | 'sessions' = 'sessions',
    id = this.sessionService.current()?.id,
  ) {
    if (!id) return;
    this.closePreview();
    this.previewReturnFocus = document.activeElement as HTMLElement;
    const request = ++this.previewRequest;
    this.previewOpen.set(true);
    this.previewLoading.set(true);
    this.previewName.set(name);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.file-preview-dialog')?.focus(),
    );
    try {
      const response = await this.http.raw(
        '/workspaces/' + kind + '/' + id + '/preview?name=' + encodeURIComponent(name),
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'File not available');
      }
      const mime = response.headers.get('Content-Type') || '';
      const blob = await response.blob();
      if (request !== this.previewRequest) return;
      if (mime.startsWith('text/')) {
        this.previewKind.set('text');
        this.previewText.set(await blob.text());
      } else if (mime.startsWith('image/') || mime === 'application/pdf') {
        const url = URL.createObjectURL(blob);
        this.previewUrl.set(url);
        this.previewKind.set(mime === 'application/pdf' ? 'pdf' : 'image');
        if (mime === 'application/pdf')
          this.previewPdf.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      } else throw new Error('Format does not support viewing');
    } catch (e) {
      if (request === this.previewRequest) this.previewError.set((e as Error).message);
    } finally {
      if (request === this.previewRequest) this.previewLoading.set(false);
    }
  }
  closePreview() {
    this.previewRequest++;
    if (this.previewUrl()) URL.revokeObjectURL(this.previewUrl());
    this.previewOpen.set(false);
    this.previewUrl.set('');
    this.previewPdf.set(null);
    this.previewText.set('');
    this.previewError.set('');
    this.previewKind.set('');
    this.previewReturnFocus?.focus();
    this.previewReturnFocus = undefined;
  }
}
