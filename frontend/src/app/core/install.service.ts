import { Injectable, signal } from '@angular/core';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Injectable({ providedIn: 'root' })
export class InstallService {
  private deferred: InstallPrompt | null = null;
  readonly available = signal(false);
  readonly installed = signal(
    navigator.userAgent.includes('AI-Router-Desktop/') ||
    window.matchMedia('(display-mode: standalone)').matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone,
  );
  readonly busy = signal(false);
  readonly message = signal('');

  constructor() {
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      this.deferred = event as InstallPrompt;
      this.available.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.available.set(false);
      this.installed.set(true);
    });
    window.matchMedia('(display-mode: standalone)').addEventListener('change', event => {
      this.installed.set(navigator.userAgent.includes('AI-Router-Desktop/') || event.matches);
    });
  }

  async install() {
    const prompt = this.deferred;
    if (!prompt || this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      this.message.set(choice.outcome === 'accepted'
        ? 'Request accepted. Wait for your browser to finish installing.'
        : 'Installation cancelled. You can add the app from your browser menu.');
    } catch {
      this.message.set('Open your browser menu and add AI Router to your home screen.');
    } finally {
      this.deferred = null;
      this.available.set(false);
      this.busy.set(false);
    }
  }
}
