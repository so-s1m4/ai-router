import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { FeedbackService } from './feedback.service';
import { FileGroup } from './models';

@Injectable({ providedIn: 'root' })
export class FileLibraryService {
  private readonly http = inject(ApiService);
  private readonly feedback = inject(FeedbackService);
  readonly error = this.feedback.error;
  fileGroups = signal<FileGroup[]>([]);
  libraryLoading = signal(false);
  libraryQuery = signal('');
  librarySource = signal('');
  selectedLibraryFiles = signal<Set<string>>(new Set());
  librarySelectionKey(group: Pick<FileGroup, 'kind' | 'id'>, name: string) {
    return JSON.stringify([group.kind, group.id, name]);
  }
  libraryGroups = computed(() =>
    this.fileGroups()
      .filter((g) => !this.librarySource() || g.kind + ':' + g.id === this.librarySource())
      .map((g) => ({
        ...g,
        files: g.files.filter((f) =>
          f.name.toLowerCase().includes(this.libraryQuery().trim().toLowerCase()),
        ),
      }))
      .filter((g) => g.files.length || g.error),
  );
  async refreshLibrary() {
    if (this.libraryLoading()) return;
    this.libraryLoading.set(true);
    this.error.set('');
    try {
      this.fileGroups.set((await this.http.request<{ groups: FileGroup[] }>('/files')).groups);
      const keys = new Set(
        this.fileGroups().flatMap((g) => g.files.map((f) => this.librarySelectionKey(g, f.name))),
      );
      this.selectedLibraryFiles.update(
        (selected) => new Set([...selected].filter((key) => keys.has(key))),
      );
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.libraryLoading.set(false);
    }
  }
  libraryVisibleKeys = computed(() =>
    this.libraryGroups().flatMap((g) => g.files.map((f) => this.librarySelectionKey(g, f.name))),
  );
  allLibraryFilesSelected = computed(
    () =>
      this.libraryVisibleKeys().length > 0 &&
      this.libraryVisibleKeys().every((key) => this.selectedLibraryFiles().has(key)),
  );
  someLibraryFilesSelected = computed(() =>
    this.libraryVisibleKeys().some((key) => this.selectedLibraryFiles().has(key)),
  );
}
