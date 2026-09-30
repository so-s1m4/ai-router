import { inject, Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly isOwner = this.auth.isOwner;
  users = signal<{ id: string; username: string; createdAt: string }[]>([]);
  newUsername = '';
  newUserPassword = '';
  userAdminError = '';
  userAdminNotice = '';
  async refreshUsers() {
    if (!this.isOwner()) return;
    try {
      this.users.set(
        await this.http.request<{ id: string; username: string; createdAt: string }[]>('/users'),
      );
      this.userAdminError = '';
    } catch (e) {
      this.userAdminError = (e as Error).message;
    }
  }
  async createUser() {
    this.userAdminError = '';
    this.userAdminNotice = '';
    try {
      await this.http.request('/users', {
        method: 'POST',
        body: JSON.stringify({ username: this.newUsername, password: this.newUserPassword }),
      });
      this.newUsername = '';
      this.newUserPassword = '';
      this.userAdminNotice = 'User created';
      await this.refreshUsers();
    } catch (e) {
      this.userAdminError = (e as Error).message;
    }
  }
  async resetUserPassword(id: string) {
    const password = window.prompt('New password (minimum 12 characters)');
    if (password === null) return;
    try {
      await this.http.request(`/users/${encodeURIComponent(id)}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password }),
      });
      this.userAdminNotice = 'Password updated';
      this.userAdminError = '';
    } catch (e) {
      this.userAdminError = (e as Error).message;
    }
  }
  async removeUser(id: string, username: string) {
    if (!window.confirm(`Delete user ${username}?`)) return;
    try {
      await this.http.request(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
      this.userAdminNotice = 'User deleted';
      await this.refreshUsers();
    } catch (e) {
      this.userAdminError = (e as Error).message;
    }
  }
}
