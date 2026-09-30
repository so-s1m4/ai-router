import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { FeedbackService } from './feedback.service';
import { QueueTask, UsageSummary } from './models';

@Injectable({ providedIn: 'root' })
export class UsageService {
  private readonly http = inject(ApiService);
  private readonly feedback = inject(FeedbackService);
  readonly error = this.feedback.error;
  readonly notice = this.feedback.notice;
  tasks = signal<QueueTask[]>([]);
  usageSummary = signal<UsageSummary | null>(null);
  resumingTask = signal('');
  canResumeTask(task: QueueTask) {
    return (
      (task.state === 'error' || task.state === 'canceled') &&
      task.recovery?.checkpoint === true &&
      !task.resumedBy
    );
  }
  async resumeTask(task: QueueTask) {
    if (this.resumingTask()) return;
    this.resumingTask.set(task.id);
    this.error.set('');
    try {
      await this.http.request('/tasks/' + task.id + '/resume', { method: 'POST' });
      await this.refreshTasks();
      this.notice.set('Continuation requested');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.resumingTask.set('');
    }
  }
  async refreshTasks() {
    try {
      this.tasks.set(await this.http.request<QueueTask[]>('/tasks'));
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  async refreshUsageSummary() {
    try {
      this.usageSummary.set(await this.http.request<UsageSummary>('/usage-summary'));
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  async changeTaskPriority(task: QueueTask, priority: string) {
    try {
      await this.http.request('/tasks/' + task.id, {
        method: 'PATCH',
        body: JSON.stringify({ priority: Number(priority) }),
      });
      await this.refreshTasks();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  async cancelTask(task: QueueTask) {
    try {
      await this.http.request('/tasks/' + task.id, { method: 'DELETE' });
      await this.refreshTasks();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  projectUsageName(id: string) {
    return id === 'no-project'
      ? 'Without project'
      : this.usageSummary()?.projects.find((p) => p.id === id)?.name || id;
  }
}
