import { Injectable, signal } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class FeedbackService {
  readonly error = signal('');
  readonly notice = signal('');
  readonly now = signal(Date.now());
}
