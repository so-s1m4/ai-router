import { Injectable, signal } from '@angular/core';
import { ChatSession } from './models';

@Injectable({ providedIn: 'root' })
export class SessionsService {
  sessions = signal<ChatSession[]>([]);
  current = signal<ChatSession | null>(null);
}
