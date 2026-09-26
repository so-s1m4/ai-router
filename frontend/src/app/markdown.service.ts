import { Injectable, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

function escapeHtml(str: string): string {
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// Register language aliases
try {
  hljs.registerAliases(['js'], { languageName: 'javascript' });
  hljs.registerAliases(['ts'], { languageName: 'typescript' });
  hljs.registerAliases(['py'], { languageName: 'python' });
  hljs.registerAliases(['sh', 'zsh'], { languageName: 'bash' });
  hljs.registerAliases(['html'], { languageName: 'xml' });
  hljs.registerAliases(['yml'], { languageName: 'yaml' });
  hljs.registerAliases(['c', 'h', 'hpp'], { languageName: 'cpp' });
  hljs.registerAliases(['cs'], { languageName: 'csharp' });
  hljs.registerAliases(['docker'], { languageName: 'dockerfile' });
} catch {
  // Aliases already registered or not supported
}

@Injectable({
  providedIn: 'root'
})
export class MarkdownService {
  private sanitizer = inject(DomSanitizer);
  private markedInstance: Marked;
  private cache = new Map<string, SafeHtml>();
  private readonly MAX_CACHE_SIZE = 400;

  constructor() {
    this.markedInstance = new Marked({
      gfm: true,
      breaks: true
    });

    this.markedInstance.use({
      renderer: {
        code: ({ text, lang }) => {
          const cleanLang = (lang || '').trim().toLowerCase();
          let highlighted = '';

          if (cleanLang && hljs.getLanguage(cleanLang)) {
            try {
              highlighted = hljs.highlight(text, { language: cleanLang, ignoreIllegals: true }).value;
            } catch {
              highlighted = escapeHtml(text);
            }
          } else {
            highlighted = escapeHtml(text);
          }

          const displayLang = cleanLang || 'text';
          const safeLang = escapeHtml(displayLang);

          return `<div class="code-block">
  <div class="code-header">
    <span class="code-lang">${safeLang}</span>
    <button type="button" class="copy-code-btn" aria-label="Скопировать код" title="Скопировать код">
      <svg class="copy-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
      </svg>
      <svg class="check-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span class="copy-label">Копировать</span>
    </button>
  </div>
  <pre><code class="hljs language-${safeLang}">${highlighted}</code></pre>
</div>`;
        },
        link: ({ href, title, text }) => {
          const cleanHref = href || '#';
          const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
          return `<a href="${escapeHtml(cleanHref)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
        }
      }
    });
  }

  render(markdownText: string | null | undefined): SafeHtml {
    if (!markdownText) return '';

    const cached = this.cache.get(markdownText);
    if (cached) return cached;

    try {
      const rawHtml = this.markedInstance.parse(markdownText) as string;
      const cleanHtml = DOMPurify.sanitize(rawHtml, {
        USE_PROFILES: { html: true, svg: true },
        ADD_TAGS: ['input'],
        ADD_ATTR: ['target', 'rel', 'checked', 'disabled', 'aria-label', 'title']
      });

      const safe = this.sanitizer.bypassSecurityTrustHtml(cleanHtml);

      if (this.cache.size >= this.MAX_CACHE_SIZE) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) this.cache.delete(oldestKey);
      }
      this.cache.set(markdownText, safe);

      return safe;
    } catch (e) {
      console.error('Markdown parse error:', e);
      return this.sanitizer.bypassSecurityTrustHtml(escapeHtml(markdownText));
    }
  }
}
