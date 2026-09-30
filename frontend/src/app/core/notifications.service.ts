import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { FeedbackService } from './feedback.service';

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(ApiService);
  private readonly feedback = inject(FeedbackService);
  readonly error = this.feedback.error;
  telegram = signal<{
    configured: boolean;
    connected: boolean;
    name: string;
    enabled: boolean;
    lastError: string;
  } | null>(null);
  telegramLink = signal('');
  telegramBusy = signal(false);
  browserNotifications = signal(false);
  async refreshTelegram() {
    try {
      this.telegram.set(await this.http.request('/notifications/telegram'));
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  async connectTelegram() {
    this.telegramBusy.set(true);
    this.error.set('');
    try {
      this.telegramLink.set(
        (
          await this.http.request<{ url: string }>('/notifications/telegram/connect', {
            method: 'POST',
            body: '{}',
          })
        ).url,
      );
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.telegramBusy.set(false);
    }
  }
  async disconnectTelegram() {
    this.telegramBusy.set(true);
    try {
      await this.http.request('/notifications/telegram', { method: 'DELETE' });
      this.telegramLink.set('');
      await this.refreshTelegram();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.telegramBusy.set(false);
    }
  }
  async toggleTelegram() {
    this.telegramBusy.set(true);
    try {
      await this.http.request('/notifications/telegram', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !this.telegram()?.enabled }),
      });
      await this.refreshTelegram();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.telegramBusy.set(false);
    }
  }
  async enableBrowserNotifications() {
    if (!('Notification' in window)) {
      this.error.set('Browser doesn’t support notifications');
      return;
    }
    if (this.browserNotifications()) {
      this.browserNotifications.set(false);
      return;
    }
    const permission = await Notification.requestPermission();
    this.browserNotifications.set(permission === 'granted');
    if (permission !== 'granted') this.error.set('Allow notifications in your browser settings');
  }
}
