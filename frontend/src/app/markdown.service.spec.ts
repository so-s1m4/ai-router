import { TestBed } from '@angular/core/testing';
import { SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MarkdownService } from './markdown.service';

describe('MarkdownService tables', () => {
  function render(markdown: string): HTMLDivElement {
    const service = TestBed.inject(MarkdownService);
    const sanitizer = TestBed.inject(DomSanitizer);
    const element = document.createElement('div');
    element.innerHTML = sanitizer.sanitize(SecurityContext.HTML, service.render(markdown)) || '';
    return element;
  }

  it('renders the staffing example as three rows without inventing a header', () => {
    const element = render(`|---|---|
| Staff recruitment — planning staffing needs, attracting applicants, and selecting employees | A company needs two sales assistants, advertises the vacancies, interviews applicants, and hires the best candidates. |
| Staff management — paying, evaluating, developing, and motivating employees | A manager reviews employees’ performance, provides training, and rewards good results with bonuses. |
| Staff reduction and departure management — reducing staff numbers and managing employees’ exits | A company reduces its workforce when demand falls and organizes handovers when employees leave or retire. |`);
    expect(element.querySelectorAll('tbody tr').length).toBe(3);
    expect(element.querySelectorAll('td').length).toBe(6);
    expect(element.querySelector('thead')).toBeNull();
    expect(element.querySelector('td')?.textContent).toContain('Staff recruitment');
    expect(element.querySelector('td:last-child')?.textContent).toContain('two sales assistants');
  });

  it('preserves ordinary GFM tables and inline formatting', () => {
    const element = render('| Activity | Example |\n|---|---|\n| **Recruitment** | `Interview` |');
    expect(element.querySelectorAll('th').length).toBe(2);
    expect(element.querySelectorAll('tbody tr').length).toBe(1);
    expect(element.querySelector('td strong')?.textContent).toBe('Recruitment');
    expect(element.querySelector('td code')?.textContent).toBe('Interview');
  });

  it('handles alignment, escaped pipes, inline formatting and surrounding prose', () => {
    const element = render('Before\n|:---|---:|\n| **Left** \\| text | `right` |\n\nAfter');
    expect(element.querySelectorAll('p').length).toBe(2);
    expect(element.querySelectorAll('td').length).toBe(2);
    expect(element.querySelector('td')?.getAttribute('align')).toBe('left');
    expect(element.querySelector('td')?.textContent).toBe('Left | text');
    expect(element.querySelector('td strong')?.textContent).toBe('Left');
    expect(element.querySelector('td:last-child')?.getAttribute('align')).toBe('right');
    expect(element.querySelector('td code')?.textContent).toBe('right');
  });

  it('leaves fenced and indented code intact', () => {
    for (const markdown of ['```markdown\n|---|---|\n| A | B |\n```', '    |---|---|\n    | A | B |']) {
      const element = render(markdown);
      expect(element.querySelector('table')).toBeNull();
      expect(element.querySelector('pre code')?.textContent).toContain('|---|---|');
    }
  });

  it('sanitizes HTML in headerless cells', () => {
    const element = render('|---|---|\n| <img src="x" onerror="alert(1)"> | <script>alert(1)</script> |');
    expect(element.querySelectorAll('td').length).toBe(2);
    expect(element.querySelector('script')).toBeNull();
    expect(element.querySelector('img')?.hasAttribute('onerror')).toBeFalse();
  });

  it('handles a streamed separator before any rows arrive', () => {
    expect(render('|---|---|').querySelector('table')).toBeNull();
    expect(render('|---|---|\n| A | B |').querySelectorAll('td').length).toBe(2);
  });
});
