import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';

interface Run {
  id: number; repository: string; title: string; name: string; branch: string;
  status: string; createdAt: string; url: string;
}
interface Job {
  id: number; name: string; status: string;
  steps: { number: number; name: string; status: string }[];
}

@Component({
  selector: 'app-github-run-widget',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './github-run-widget.html',
  styleUrl: './github-run-widget.css',
})
export class GithubRunWidgetComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly run = signal<Run | null>(null);
  readonly jobs = signal<Job[]>([]);
  readonly collapsed = signal(true);
  readonly dismissedRunId = signal<number | null>(null);
  readonly stale = signal(false);
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private loading = false;

  ngOnInit() {
    void this.refresh();
    this.timer = setInterval(() => { if (!document.hidden) void this.refresh(); }, 30000);
  }

  @HostListener('document:visibilitychange')
  onVisible() { if (!document.hidden) void this.refresh(); }

  async refresh() {
    if (this.loading || this.disposed) return;
    this.loading = true;
    try {
      const connection = await this.api.request<{ connected: boolean }>('/github');
      if (this.disposed) return;
      if (!connection.connected) { this.run.set(null); this.jobs.set([]); return; }
      const data = await this.api.request<{ runs: Run[] }>('/github/runs');
      if (this.disposed) return;
      const latest = data.runs.filter(run => run.status !== 'completed')
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)[0] ?? null;
      if (this.run()?.id !== latest?.id) { this.jobs.set([]); this.collapsed.set(true); }
      this.run.set(latest);
      this.stale.set(false);
      if (!latest) return;
      try {
        const detail = await this.api.request<{ jobs: Job[] }>(`/github/${latest.repository}/runs/${latest.id}/jobs`);
        if (!this.disposed) this.jobs.set(detail.jobs);
      } catch { if (!this.disposed) { this.jobs.set([]); this.stale.set(true); } }
    } catch (error) {
      if (this.disposed) return;
      if ([401, 403, 404].includes((error as { status?: number }).status ?? 0)) {
        this.run.set(null); this.jobs.set([]);
      } else this.stale.set(true);
    } finally { this.loading = false; }
  }

  label(status: string) {
    return ({ in_progress: 'In progress', queued: 'Queued', waiting: 'Waiting', pending: 'Waiting', requested: 'Requested' } as Record<string, string>)[status] || status;
  }

  ngOnDestroy() {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
  }
}
