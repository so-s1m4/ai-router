import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
type Identity = { username: string; isOwner: boolean };
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(ApiService);
  readonly loggedIn = signal(false);
  readonly isOwner = signal(false);
  readonly registerMode = signal(false);
  username = '';
  password = '';
  loginName = '';
  loginError = '';
  private accept(me: Identity) {
    this.username = me.username;
    this.isOwner.set(!!me.isOwner);
    this.loggedIn.set(true);
    this.password = '';
  }
  private restoring?: Promise<boolean>;
  ensureSession(): Promise<boolean> {
    if (this.loggedIn()) return Promise.resolve(true);
    return (this.restoring ??= this.restore().finally(() => {
      this.restoring = undefined;
    }));
  }
  async restore() {
    try {
      this.accept(await this.http.request<Identity>('/me'));
      return true;
    } catch {
      return false;
    }
  }
  async login() {
    this.loginError = '';
    try {
      this.accept(
        await this.http.request<Identity>(this.registerMode() ? '/register' : '/login', {
          method: 'POST',
          body: JSON.stringify({ username: this.loginName, password: this.password }),
        }),
      );
      return true;
    } catch (error) {
      this.loginError = (error as Error).message;
      return false;
    }
  }
  async logout() {
    await this.http.request('/logout', { method: 'POST' }).catch(() => {});
    this.password = '';
    this.username = '';
    this.isOwner.set(false);
    this.loggedIn.set(false);
  }
}
