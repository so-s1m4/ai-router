import { Pipe, PipeTransform, inject } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { MarkdownService } from './markdown.service';

@Pipe({
  name: 'markdown',
  standalone: true,
  pure: true
})
export class MarkdownPipe implements PipeTransform {
  private markdownService = inject(MarkdownService);

  transform(value: string | null | undefined): SafeHtml {
    return this.markdownService.render(value);
  }
}
