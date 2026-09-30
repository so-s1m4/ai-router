import { computed, inject, Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { FeedbackService } from './feedback.service';
import { FileNodeInternal, FlatFileNode } from './models';
import { SessionsService } from './sessions.service';
@Injectable({ providedIn: 'root' })
export class TaskFilesService {
  private readonly http = inject(ApiService);
  private readonly feedback = inject(FeedbackService);
  readonly error = this.feedback.error;
  private readonly sessionService = inject(SessionsService);
  readonly current = this.sessionService.current;
  selectedTaskFiles = signal<Set<string>>(new Set());
  filteredTaskFileNames = computed(() =>
    this.taskFiles()
      .filter((f) => f.name.toLowerCase().includes(this.filesFilter().trim().toLowerCase()))
      .map((f) => f.name),
  );
  allTaskFilesSelected = computed(
    () =>
      this.filteredTaskFileNames().length > 0 &&
      this.filteredTaskFileNames().every((name) => this.selectedTaskFiles().has(name)),
  );
  someTaskFilesSelected = computed(() =>
    this.filteredTaskFileNames().some((name) => this.selectedTaskFiles().has(name)),
  );
  taskFiles = signal<{ name: string; size: number; modified: string }[]>([]);
  sharedFileLinks = signal<Record<string, string>>({});
  deletingFile = signal('');
  filesOpen = signal(false);
  filesLoading = signal(false);
  collapsedDirs = signal<Set<string>>(new Set());
  filesFilter = signal<string>('');
  async refreshTaskFiles() {
    const id = this.current()?.id;
    if (!id) return;
    this.filesLoading.set(true);
    try {
      const result = await this.http.request<{
        files: { name: string; size: number; modified: string }[];
      }>(`/sessions/${id}/files`);
      if (this.current()?.id === id) {
        this.taskFiles.set(result.files);
        const names = new Set(result.files.map((f) => f.name));
        this.selectedTaskFiles.update(
          (selected) => new Set([...selected].filter((name) => names.has(name))),
        );
      }
    } catch (e) {
      if (this.filesOpen()) this.error.set((e as Error).message);
    } finally {
      this.filesLoading.set(false);
    }
  }
  toggleTaskFiles() {
    this.filesOpen.update((open) => !open);
    if (this.filesOpen()) void this.refreshTaskFiles();
  }
  formatFileSize(bytes?: number): string {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
  pluralizeFiles(count: number): string {
    return count === 1 ? 'file' : 'files';
  }
  hasDirectories = computed(() => this.taskFiles().some((f) => f.name.includes('/')));
  totalFilesSize = computed(() => {
    const total = this.taskFiles().reduce((acc, f) => acc + (f.size || 0), 0);
    return this.formatFileSize(total);
  });
  allDirPaths = computed(() => {
    const dirs = new Set<string>();
    for (const file of this.taskFiles()) {
      const parts = file.name.split('/').filter(Boolean);
      let cur = '';
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i];
        dirs.add(cur);
      }
    }
    return Array.from(dirs);
  });
  visibleFileTree = computed<FlatFileNode[]>(() => {
    const files = this.taskFiles();
    const filter = this.filesFilter().trim().toLowerCase();
    const collapsed = this.collapsedDirs();
    const root: FileNodeInternal = {
      name: '',
      path: '',
      isDir: true,
      size: 0,
      fileCount: 0,
      children: new Map(),
    };
    for (const file of files) {
      if (filter && !file.name.toLowerCase().includes(filter)) {
        continue;
      }
      const parts = file.name.split('/').filter(Boolean);
      if (!parts.length) continue;
      let current = root;
      let currentPath = '';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (isFile) {
          current.children.set(part, {
            name: part,
            path: file.name,
            isDir: false,
            size: file.size,
            modified: file.modified,
            fileCount: 1,
            children: new Map(),
          });
        } else {
          let dirNode = current.children.get(part);
          if (!dirNode) {
            dirNode = {
              name: part,
              path: currentPath,
              isDir: true,
              size: 0,
              fileCount: 0,
              children: new Map(),
            };
            current.children.set(part, dirNode);
          }
          current = dirNode;
        }
      }
    }
    function rollup(node: FileNodeInternal): { size: number; count: number } {
      if (!node.isDir) return { size: node.size, count: 1 };
      let totalSize = 0;
      let totalCount = 0;
      for (const child of node.children.values()) {
        const res = rollup(child);
        totalSize += res.size;
        totalCount += res.count;
      }
      node.size = totalSize;
      node.fileCount = totalCount;
      return { size: totalSize, count: totalCount };
    }
    rollup(root);
    const result: FlatFileNode[] = [];
    function flatten(node: FileNodeInternal, depth: number) {
      const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      for (const child of sortedChildren) {
        if (child.isDir) {
          const isExpanded = filter ? true : !collapsed.has(child.path);
          result.push({
            name: child.name,
            path: child.path,
            isDir: true,
            depth,
            size: child.size,
            fileCount: child.fileCount,
            isExpanded,
          });
          if (isExpanded) {
            flatten(child, depth + 1);
          }
        } else {
          result.push({
            name: child.name,
            path: child.path,
            isDir: false,
            depth,
            size: child.size,
            modified: child.modified,
          });
        }
      }
    }
    flatten(root, 0);
    return result;
  });
  toggleFolder(path: string) {
    this.collapsedDirs.update((set) => {
      const next = new Set(set);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }
  collapseAllFolders() {
    this.collapsedDirs.set(new Set(this.allDirPaths()));
  }
  expandAllFolders() {
    this.collapsedDirs.set(new Set());
  }
}
