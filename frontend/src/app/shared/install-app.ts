import { Component, ElementRef, Input, ViewChild, inject } from '@angular/core';
import { InstallService } from '../core/install.service';

@Component({
  selector: 'app-install-app',
  standalone: true,
  template: `
    @if (!install.installed()) {
      <button class="install-trigger" [class.compact]="compact" type="button" title="Install AI Router" aria-label="Install AI Router" (click)="open()">@if (compact) { <span aria-hidden="true">↓</span> } @else { Install AI Router }</button>
    }
    <dialog #dialog (close)="closed()" (click)="backdrop($event)">
      <div class="install-heading"><img src="/icons/icon-192.png" width="48" height="48" alt=""><button type="button" aria-label="Close" (click)="dialog.close()">✕</button></div>
      <h2>AI Router on your home screen</h2>
      <p>Open your workspace with one tap. Chats and tasks require a server connection.</p>
      @if (install.available()) {
        <button class="install-primary" type="button" [disabled]="install.busy()" (click)="install.install()">{{ install.busy() ? 'Waiting for browser…' : 'Install app' }}</button>
      }
      @if (install.message()) { <p role="status">{{ install.message() }}</p> }
      <h3>Huawei Browser</h3>
      <ol><li>Open your browser menu <strong>⋮ / ∷</strong>.</li><li>Select <strong>Add to → Desktop</strong> or <strong>Add to home screen</strong>.</li><li>Confirm the name <strong>AI Router</strong> and add the app.</li></ol>
      <p class="install-note">Menu labels and opening behavior vary by Huawei Browser and HarmonyOS / EMUI version.</p>
      <details><summary>Another browser</summary><p>Chrome / Edge: menu → Install app or Add to home screen. iPhone / iPad: Safari → Share → Add to Home Screen.</p></details>
      <a href="https://consumer.huawei.com/cn/support/content/zh-cn00448896/" target="_blank" rel="noopener noreferrer">Huawei instructions ↗</a>
    </dialog>
  `,
  styles: [`
    :host { display: contents; }
    .install-trigger { display:block; margin:12px auto 0; padding:8px 12px; background:transparent; color:var(--text-secondary,#aaa); border:1px solid var(--border-subtle,#444); border-radius:9px; cursor:pointer; font:inherit; font-size:12px; }
    .install-trigger.compact { width:32px; height:36px; margin:0; padding:0; font-size:23px; flex-shrink:0; }
    dialog { box-sizing:border-box; width:calc(100% - 32px); max-width:440px; max-height:calc(100vh - 32px); max-height:calc(100dvh - 32px); overflow:auto; border:1px solid #414141; border-radius:22px; background:#1c1c1c; color:#eee; padding:24px; font:14px/1.6 system-ui; }
    dialog::backdrop { background:#000a; }
    .install-heading { display:flex; align-items:center; justify-content:space-between; }
    img { border-radius:14px; }
    .install-heading button { border:0; background:transparent; color:#bbb; padding:12px; cursor:pointer; font-size:18px; }
    h2 { font-size:21px; line-height:1.3; margin:20px 0 12px; } h3 { margin-bottom:8px; font-size:15px; }
    p,li { color:#bbb; } ol { padding-left:22px; } li { padding:4px 0; } strong { color:#eee; }
    .install-primary { width:100%; padding:12px; border:0; border-radius:12px; background:#6567ed; color:white; font:inherit; cursor:pointer; } button:disabled { opacity:.6; cursor:wait; }
    .install-note { font-size:12px; } summary { cursor:pointer; } a { display:inline-block; margin-top:16px; color:#b7b8ff; }
  `],
})
export class InstallAppComponent {
  @Input() compact = false;
  readonly install = inject(InstallService);
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  private trigger: HTMLElement | null = null;
  open() {
    this.trigger = document.activeElement as HTMLElement;
    this.dialog.nativeElement.showModal();
  }
  closed() {
    this.trigger?.focus();
  }
  backdrop(event: MouseEvent) {
    if (event.target === this.dialog.nativeElement) {
      const box = this.dialog.nativeElement.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) this.dialog.nativeElement.close();
    }
  }
}
