import { ElementRef, inject, Injectable, signal } from '@angular/core';
import { SessionsService } from './sessions.service';
@Injectable({ providedIn: 'root' })
export class ChatViewService {
  private readonly sessionService = inject(SessionsService);
  readonly current = this.sessionService.current;
  composerTextareaRef?: ElementRef<HTMLTextAreaElement>;
  userScrolledUp = signal(false);
  showScrollBottom = signal(false);
  chatScrollArea?: ElementRef<HTMLDivElement>;
  messageFeed?: ElementRef<HTMLDivElement>;
  scrollRaf?: number;
  resizeObserver?: ResizeObserver;
  isProgrammaticScroll = false;
  isSmoothScrollingToBottom = false;
  smoothScrollTimeout?: ReturnType<typeof setTimeout>;
  lastScrollTop = 0;
  viewportRaf?: number;
  onViewportResize = () => {
    if (this.viewportRaf !== undefined) return;
    this.viewportRaf = requestAnimationFrame(() => {
      this.viewportRaf = undefined;
      const viewport = window.visualViewport;
      // Pinch zoom keeps the layout intact; keyboard/browser chrome resize it.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const height = viewport?.height ?? window.innerHeight;
      const root = document.documentElement;
      root.style.setProperty('--app-height', height + 'px');
      root.style.setProperty('--app-top', (viewport?.offsetTop ?? 0) + 'px');
      const active = document.activeElement;
      const editing =
        active instanceof HTMLElement &&
        active.matches(
          'input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]',
        );
      root.classList.toggle('keyboard-open', editing && window.innerHeight - height > 150);
      if (
        this.current()?.messages.length &&
        !this.userScrolledUp() &&
        active?.matches('.pill-textarea')
      ) {
        this.requestScrollToBottom();
      }
      if (editing) {
        const bounds = active.getBoundingClientRect();
        const top = viewport?.offsetTop ?? 0;
        if (bounds.top < top || bounds.bottom > top + height) {
          active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        }
      }
    });
  };
  private attachmentTimer?: ReturnType<typeof setTimeout>;
  detachChatView() {
    if (this.attachmentTimer) clearTimeout(this.attachmentTimer);
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    if (this.smoothScrollTimeout) clearTimeout(this.smoothScrollTimeout);
    this.cleanupResizeObserver();
    this.chatScrollArea = undefined;
    this.messageFeed = undefined;
    this.composerTextareaRef = undefined;
    this.heroComposerTextareaRef = undefined;
  }
  ngAfterViewInit() {
    this.setupResizeObserver();
    this.scrollToBottom(true, 'auto');
  }
  setupResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    const container = this.chatScrollArea?.nativeElement;
    const feed = this.messageFeed?.nativeElement;
    if (!container) return;

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.userScrolledUp()) {
        this.scrollToBottom(false, 'auto');
      }
    });

    this.resizeObserver.observe(container);
    if (feed) {
      this.resizeObserver.observe(feed);
    }
  }
  cleanupResizeObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
  }
  ensureChatScrollAttached(forceScroll = false) {
    this.userScrolledUp.set(false);
    this.showScrollBottom.set(false);
    this.isSmoothScrollingToBottom = false;
    if (this.attachmentTimer) clearTimeout(this.attachmentTimer);
    this.attachmentTimer = setTimeout(() => {
      this.attachmentTimer = undefined;
      this.setupResizeObserver();
      if (forceScroll) {
        this.scrollToBottom(true, 'auto');
      }
    }, 0);
  }
  onChatWheel(event: WheelEvent) {
    if (event.deltaY < 0) {
      this.userScrolledUp.set(true);
      this.showScrollBottom.set(true);
    }
  }
  onChatTouch() {
    this.userScrolledUp.set(true);
    this.showScrollBottom.set(true);
  }
  onChatScroll() {
    const el = this.chatScrollArea?.nativeElement;
    if (!el) return;

    const currentScrollTop = el.scrollTop;
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const distanceFromBottom = Math.max(0, scrollHeight - currentScrollTop - clientHeight);

    if (this.isProgrammaticScroll) {
      this.lastScrollTop = currentScrollTop;
      return;
    }

    if (this.isSmoothScrollingToBottom) {
      if (distanceFromBottom <= 40) {
        this.isSmoothScrollingToBottom = false;
        if (this.smoothScrollTimeout) {
          clearTimeout(this.smoothScrollTimeout);
          this.smoothScrollTimeout = undefined;
        }
      }
      this.lastScrollTop = currentScrollTop;
      return;
    }

    const scrollDelta = currentScrollTop - this.lastScrollTop;
    this.lastScrollTop = currentScrollTop;

    if (distanceFromBottom <= 40) {
      if (this.userScrolledUp()) this.userScrolledUp.set(false);
      if (this.showScrollBottom()) this.showScrollBottom.set(false);
    } else if (scrollDelta < -2 && distanceFromBottom > 25) {
      // User actively scrolled UP
      if (!this.userScrolledUp()) this.userScrolledUp.set(true);
      if (!this.showScrollBottom()) this.showScrollBottom.set(true);
    } else if (distanceFromBottom > 100) {
      // Significantly away from bottom
      if (!this.userScrolledUp()) this.userScrolledUp.set(true);
      if (!this.showScrollBottom()) this.showScrollBottom.set(true);
    }
  }
  scrollToBottom(force = false, behavior: ScrollBehavior = 'auto') {
    if (!force && this.userScrolledUp()) {
      return;
    }
    const el = this.chatScrollArea?.nativeElement;
    if (!el) return;

    if (force) {
      this.userScrolledUp.set(false);
      this.showScrollBottom.set(false);
    }

    if (behavior === 'smooth') {
      this.isSmoothScrollingToBottom = true;
      if (this.smoothScrollTimeout) clearTimeout(this.smoothScrollTimeout);
      this.smoothScrollTimeout = setTimeout(() => {
        this.isSmoothScrollingToBottom = false;
      }, 800);
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      this.isProgrammaticScroll = true;
      el.scrollTop = el.scrollHeight;
      this.lastScrollTop = el.scrollTop;
      requestAnimationFrame(() => {
        this.isProgrammaticScroll = false;
        if (el) this.lastScrollTop = el.scrollTop;
      });
    }
  }
  requestScrollToBottom(force = false, behavior: ScrollBehavior = 'auto') {
    if (force) {
      this.userScrolledUp.set(false);
      this.showScrollBottom.set(false);
    } else if (this.userScrolledUp()) {
      return;
    }
    if (this.scrollRaf) {
      cancelAnimationFrame(this.scrollRaf);
    }
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = undefined;
      this.scrollToBottom(force, behavior);
    });
  }
  heroComposerTextareaRef?: ElementRef<HTMLTextAreaElement>;
  adjustHeroTextareaHeight() {
    const el = this.heroComposerTextareaRef?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }
  adjustTextareaHeight() {
    const el = this.composerTextareaRef?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }
}
