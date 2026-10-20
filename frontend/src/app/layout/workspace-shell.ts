import { CommonModule } from '@angular/common';
import { Component, effect, HostListener, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LucideFolder,LucideGlobe2,LucideMenu,LucideSquarePen } from '@lucide/angular';
import { WorkspaceStore } from '../core/workspace.store';
import { ChatSidebarComponent } from '../layout/chat-sidebar';
import { NavigationRailComponent } from '../layout/navigation-rail';
import { PageHeaderComponent } from '../layout/page-header';
import { GithubRunWidgetComponent } from '../shared/github-run-widget';
@Component({
  selector: 'app-workspace-shell',
  standalone: true,
  imports: [
    CommonModule,
    LucideFolder,
    LucideGlobe2,
    LucideSquarePen,
    LucideMenu,
    RouterOutlet,
    NavigationRailComponent,
    ChatSidebarComponent,
    PageHeaderComponent,
    GithubRunWidgetComponent,
  ],
  templateUrl: './workspace-shell.html',
  host: { style: 'display: contents' },
})
export class WorkspaceShellComponent {
  readonly vm = inject(WorkspaceStore);
  readonly mobile = signal(window.innerWidth <= 820);
  readonly dragging = signal(false);
  readonly drawerOffset = signal<number | null>(null);
  private gesture: { x: number; y: number; open: boolean; horizontal: boolean } | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const open = this.vm.layoutService.mobileMenu() && this.mobile();
      if (open) {
        this.returnFocus = document.activeElement as HTMLElement;
        setTimeout(() => {
          if (!this.vm.layoutService.mobileMenu()) return;
          const selector = this.vm.layoutService.searchOpen() ? '.sidebar-search-input' : '.mobile-drawer-close';
          document.querySelector<HTMLElement>(selector)?.focus();
        });
      } else if (this.returnFocus) {
        const target = this.returnFocus;
        this.returnFocus = null;
        setTimeout(() => !this.vm.layoutService.mobileMenu() && target.isConnected && target.focus());
      }
    });
  }

  @HostListener('window:resize')
  resize() {
    this.mobile.set(window.innerWidth <= 820);
    this.cancelGesture();
    if (!this.mobile()) this.vm.layoutService.mobileMenu.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  keyboard(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.vm.layoutService.searchOpen.set(true);
      if (this.mobile()) this.vm.layoutService.mobileMenu.set(true);
      else this.vm.layoutService.sidebarOpen.set(true);
      setTimeout(() => document.querySelector<HTMLInputElement>('.sidebar-search-input')?.focus());
    }
    if (event.key === 'Tab' && this.mobile() && this.vm.layoutService.mobileMenu()) {
      const buttons = Array.from(document.querySelectorAll<HTMLElement>('.sidebar button:not([disabled]), .sidebar input, .sidebar select, .sidebar a[href]')).filter(el => el.getClientRects().length > 0);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  startGesture(event: TouchEvent) {
    if (!this.mobile() || event.touches.length !== 1) { this.cancelGesture(); return; }
    const target = event.target as Element;
    if (target.closest('input, textarea, select, pre, .project-dialog-backdrop, .file-preview-overlay, [role="dialog"]:not(.sidebar)')) return;
    const { clientX: x, clientY: y } = event.touches[0];
    const open = this.vm.layoutService.mobileMenu();
    // Keep the browser's outermost edge available for its own back gesture.
    if (!open && (x < 12 || x > 44)) return;
    this.gesture = { x, y, open, horizontal: false };
  }

  moveGesture(event: TouchEvent) {
    const g = this.gesture;
    if (!g) return;
    if (event.touches.length !== 1) { this.cancelGesture(); return; }
    const dx = event.touches[0].clientX - g.x;
    const dy = event.touches[0].clientY - g.y;
    if (!g.horizontal) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { this.cancelGesture(); return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.3) return;
      if ((!g.open && dx < 0) || (g.open && dx > 0)) { this.cancelGesture(); return; }
      g.horizontal = true;
    }
    if (event.cancelable) event.preventDefault();
    this.dragging.set(true);
    const width = Math.min(window.innerWidth * .88, 360);
    this.drawerOffset.set(Math.max(-width, Math.min(0, (g.open ? 0 : -width) + dx)));
  }

  endGesture() {
    const g = this.gesture;
    if (g?.horizontal) {
      const width = Math.min(window.innerWidth * .88, 360);
      const offset = this.drawerOffset() ?? -width;
      this.vm.layoutService.mobileMenu.set(g.open ? offset > -width * .25 : offset > -width * .75);
    }
    this.cancelGesture();
  }

  cancelGesture() {
    this.gesture = null;
    this.dragging.set(false);
    this.drawerOffset.set(null);
  }
}
