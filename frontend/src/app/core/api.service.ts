import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class ApiService {
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const r = await fetch('/api' + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'same-origin',
    });
    const text = await r.text();
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      const error = new Error(
        !r.ok
          ? r.status === 404
            ? 'The requested resource was not found'
            : `Server error ( ${r.status})`
          : 'Invalid server response (JSON expected)',
      ) as Error & { status: number };
      error.status = r.status;
      throw error;
    }
    if (!r.ok) {
      const error = new Error(body?.error || `Request error ( ${r.status})`) as Error & {
        status: number;
      };
      error.status = r.status;
      throw error;
    }
    return body as T;
  }
  raw(path: string, options: RequestInit = {}) {
    return fetch('/api' + path, { ...options, credentials: 'same-origin' });
  }
}
