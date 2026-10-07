import { inject, Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { ChatViewService } from './chat-view.service';
import { ChatService } from './chat.service';
import { ClipboardService } from './clipboard.service';
import { FeedbackService } from './feedback.service';
import { FileLibraryService } from './file-library.service';
import { ChatSession, FileGroup, Project, sortSessions } from './models';
import { NavigationService } from './navigation.service';
import { ProjectsService } from './projects.service';
import { RunnersService } from './runners.service';
import { SessionsService } from './sessions.service';
import { TaskFilesService } from './task-files.service';
@Injectable({ providedIn: 'root' })
export class FilesService {
  private readonly http = inject(ApiService);
  private readonly feedback = inject(FeedbackService);
  readonly error = this.feedback.error;
  readonly notice = this.feedback.notice;
  private readonly chatService = inject(ChatService);
  private readonly libraryService = inject(FileLibraryService);
  private readonly sessionService = inject(SessionsService);
  private readonly projectService = inject(ProjectsService);
  private readonly runnerService = inject(RunnersService);
  private readonly clipboardService = inject(ClipboardService);
  private readonly taskFilesService = inject(TaskFilesService);
  private readonly chatViewService = inject(ChatViewService);
  private readonly auth = inject(AuthService);
  private readonly navigation = inject(NavigationService);
  readonly page = this.navigation.page;
  readonly loggedIn = this.auth.loggedIn;
  selectProject(id: string) {
    this.projectService.selectedProjectId.set(id);
    const latest = sortSessions(
      this.sessionService.sessions().filter((s) => s.projectId === id),
    )[0];
    if (latest) void this.chatService.openSession(latest.id);
    else this.chatService.newSession();
  }
  async libraryShare(group: FileGroup, name: string, download = false) {
    try {
      const result = await this.http.request<{ url: string }>(
        '/workspaces/' + group.kind + '/' + group.id + '/share',
        { method: 'POST', body: JSON.stringify({ name }) },
      );
      const url = new URL(result.url, location.origin).href;
      if (download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = name.split('/').pop() || name;
        a.click();
      } else {
        await this.clipboardService.copy(url, 'library-share');
        this.notice.set('Link copied. Valid for 7 days.');
      }
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  emptyFileSelection() {
    return new Set<string>();
  }
  private readonly selectionAnchors: Partial<Record<'library' | 'task', { key: string; context: string }>> = {};
  toggleFileSelection(
    scope: 'library' | 'task',
    key: string,
    checked: boolean,
    shiftKey = false,
  ) {
    if (this.taskFilesService.deletingFile()) return;
    const selection =
      scope === 'library'
        ? this.libraryService.selectedLibraryFiles
        : this.taskFilesService.selectedTaskFiles;
    const context = scope === 'task' ? this.sessionService.current()?.id || '' : 'library';
    const anchor = this.selectionAnchors[scope];
    const keys =
      scope === 'library'
        ? this.libraryService.libraryVisibleKeys()
        : this.taskFilesService.visibleFileTree()
            .filter((node) => !node.isDir)
            .map((node) => node.path);
    const anchorIndex = anchor?.context === context && selection().size ? keys.indexOf(anchor.key) : -1;
    const targetIndex = keys.indexOf(key);
    const range =
      shiftKey && anchorIndex >= 0 && targetIndex >= 0
        ? keys.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
        : [key];
    if (!shiftKey || anchorIndex < 0) this.selectionAnchors[scope] = { key, context };
    selection.update((current) => {
      const next = new Set(current);
      for (const item of range) {
        if (checked) next.add(item);
        else next.delete(item);
      }
      return next;
    });
  }
  selectAllFiles(scope: 'library' | 'task', checked: boolean) {
    if (this.taskFilesService.deletingFile()) return;
    delete this.selectionAnchors[scope];
    const keys =
      scope === 'library'
        ? this.libraryService.libraryVisibleKeys()
        : this.taskFilesService.filteredTaskFileNames();
    const selection =
      scope === 'library'
        ? this.libraryService.selectedLibraryFiles
        : this.taskFilesService.selectedTaskFiles;
    selection.update((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }
  async libraryDelete(group: FileGroup, name: string) {
    await this.deleteFiles([{ kind: group.kind, id: group.id, name }]);
  }
  async deleteSelectedLibraryFiles() {
    const selected = this.libraryService.selectedLibraryFiles();
    const targets = this.libraryService
      .fileGroups()
      .flatMap((g) =>
        g.files
          .filter((f) => selected.has(this.libraryService.librarySelectionKey(g, f.name)))
          .map((f) => ({ kind: g.kind, id: g.id, name: f.name })),
      );
    await this.deleteFiles(targets);
  }
  async deleteFiles(targets: { kind: 'projects' | 'sessions'; id: string; name: string }[]) {
    if (!targets.length || this.taskFilesService.deletingFile()) return;
    const message =
      targets.length === 1
        ? 'Delete file “' + targets[0].name + '”?'
        : 'Delete selected files (' + targets.length + ')?';
    if (!confirm(message + ' Files and links to them will become unavailable.')) return;
    this.taskFilesService.deletingFile.set('bulk');
    this.error.set('');
    this.notice.set('');
    let deleted = 0;
    const failures: string[] = [];
    try {
      for (const target of targets) {
        try {
          await this.http.request(
            '/workspaces/' + target.kind + '/' + encodeURIComponent(target.id) + '/files',
            { method: 'DELETE', body: JSON.stringify({ name: target.name }) },
          );
          deleted++;
          const session = this.sessionService.current();
          const projectId =
            target.kind === 'projects'
              ? target.id
              : this.sessionService.sessions().find((s) => s.id === target.id)?.projectId ||
                (session?.id === target.id ? session.projectId : undefined);
          const matches = (kind: string, id: string): boolean =>
            projectId
              ? kind === 'projects'
                ? id === projectId
                : this.sessionService
                    .sessions()
                    .some((s) => s.id === id && s.projectId === projectId) ||
                  (session?.id === id && session?.projectId === projectId)
              : kind === target.kind && id === target.id;
          this.libraryService.fileGroups.update((groups) =>
            groups.map((g) =>
              matches(g.kind, g.id)
                ? { ...g, files: g.files.filter((f) => f.name !== target.name) }
                : g,
            ),
          );
          this.libraryService.selectedLibraryFiles.update(
            (selected) =>
              new Set(
                [...selected].filter((key) => {
                  const [kind, id, name] = JSON.parse(key);
                  return name !== target.name || !matches(kind, id);
                }),
              ),
          );
          if (session && matches('sessions', session.id)) {
            this.taskFilesService.taskFiles.update((files) =>
              files.filter((f) => f.name !== target.name),
            );
            this.taskFilesService.selectedTaskFiles.update((selected) => {
              const next = new Set(selected);
              next.delete(target.name);
              return next;
            });
            this.taskFilesService.sharedFileLinks.update((links) => {
              const next = { ...links };
              delete next[target.name];
              return next;
            });
          }
        } catch (e) {
          failures.push(target.name + ': ' + (e as Error).message);
        }
      }
      this.notice.set('Files deleted: ' + deleted + ' of ' + targets.length);
      if (failures.length) this.error.set('Failed to remove: ' + failures.join('; '));
    } finally {
      this.taskFilesService.deletingFile.set('');
    }
  }
  openFileSource(group: FileGroup) {
    if (group.kind === 'projects') {
      this.projectService.selectedProjectId.set(group.id);
      this.selectProject(group.id);
    } else void this.chatService.openSession(group.id);
  }
  uploading = signal(false);
  isDraggingOver = signal(false);
  dragCounter = 0;
  preventWindowDrop = (e: DragEvent) => {
    if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
    }
  };
  async deleteTaskFile(name: string) {
    const id = this.sessionService.current()?.id;
    if (id) await this.deleteFiles([{ kind: 'sessions', id, name }]);
  }
  async deleteSelectedTaskFiles() {
    const id = this.sessionService.current()?.id;
    if (id)
      await this.deleteFiles(
        [...this.taskFilesService.selectedTaskFiles()].map((name) => ({
          kind: 'sessions' as const,
          id,
          name,
        })),
      );
  }
  async shareTaskFile(name: string, download = false) {
    const id = this.sessionService.current()?.id;
    if (!id) return;
    try {
      const result = await this.http.request<{ url: string; expiresAt: string }>(
        `/sessions/${id}/files/share`,
        { method: 'POST', body: JSON.stringify({ name }) },
      );
      const url = new URL(result.url, window.location.origin).href;
      if (this.sessionService.current()?.id !== id) return;
      this.taskFilesService.sharedFileLinks.update((links) => ({ ...links, [name]: url }));
      if (download) {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name.split('/').pop() || name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        return;
      }
      try {
        await this.clipboardService.copy(url, 'share-' + name);
        this.notice.set('Link copied. Valid for 7 days.');
      } catch {
        this.notice.set('The link is ready. Copy it from the list of files.');
      }
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  onDragEnter(event: DragEvent) {
    if (this.page() !== 'chat' || !this.loggedIn()) return;
    if (!event.dataTransfer?.types || !Array.from(event.dataTransfer.types).includes('Files'))
      return;
    event.preventDefault();
    this.dragCounter++;
    if (this.dragCounter === 1) {
      this.isDraggingOver.set(true);
    }
  }
  onDragOver(event: DragEvent) {
    if (this.page() !== 'chat' || !this.loggedIn()) return;
    if (!event.dataTransfer?.types || !Array.from(event.dataTransfer.types).includes('Files'))
      return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }
  onDragLeave(event: DragEvent) {
    if (this.page() !== 'chat' || !this.loggedIn()) return;
    this.dragCounter--;
    if (this.dragCounter <= 0) {
      this.dragCounter = 0;
      this.isDraggingOver.set(false);
    }
  }
  onDrop(event: DragEvent) {
    if (this.page() !== 'chat' || !this.loggedIn()) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter = 0;
    this.isDraggingOver.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      void this.uploadFiles(files);
    }
  }
  onPaste(event: ClipboardEvent) {
    if (this.page() !== 'chat' || !this.loggedIn()) return;
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const files: File[] = [];
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const f = clipboardData.files[i];
        if (f) files.push(f);
      }
    } else if (clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }

    if (files.length > 0) {
      event.preventDefault();
      void this.uploadFiles(files);
    }
  }
  async ensureCurrentProjectId(): Promise<string> {
    let currentSession = this.sessionService.current();
    if (!currentSession) {
      const projectId = this.projectService.selectedProjectId() || undefined;
      currentSession = await this.http.request<ChatSession>('/sessions', {
        method: 'POST',
        body: JSON.stringify(projectId ? { projectId } : {}),
      });
      this.sessionService.current.set(currentSession);
    }
    if (currentSession.projectId) return currentSession.projectId;

    let projectId = this.projectService.selectedProjectId();
    if (!projectId && this.projectService.projects().length > 0) {
      projectId = this.projectService.projects()[0].id;
    }

    if (!projectId) {
      const activeRunner = this.runnerService.runners().find((r) => !r.revokedAt);
      if (!activeRunner) {
        throw new Error('Connect a runner to upload files');
      }
      const newProj = await this.http.request<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Main project', runnerId: activeRunner.id }),
      });
      this.projectService.projects.update((list) => [newProj, ...list]);
      projectId = newProj.id;
    }

    try {
      const updated = await this.http.request<ChatSession>('/sessions/' + currentSession.id, {
        method: 'PATCH',
        body: JSON.stringify({ projectId }),
      });
      this.sessionService.current.set(updated);
      this.sessionService.sessions.update((list) =>
        list.map((s) => (s.id === updated.id ? updated : s)),
      );
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to link files to project');
    }
    this.projectService.selectedProjectId.set(projectId);
    return projectId;
  }
  async uploadFiles(fileList: File[] | FileList) {
    const rawFiles = Array.from(fileList).filter((f) => f && f.size > 0);
    if (!rawFiles.length) return;

    this.error.set('');
    this.uploading.set(true);

    try {
      const projectId = await this.ensureCurrentProjectId();
      const uploadedNames: string[] = [];
      const errors: string[] = [];

      for (let i = 0; i < rawFiles.length; i++) {
        const file = rawFiles[i];
        let name = file.name;
        if (!name || name === 'image.png' || name === 'blob') {
          const ext = file.type ? (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg') : 'png';
          const now = new Date();
          const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
          name = `screenshot-${timeStr}.${ext}`;
        }

        let finalName = name;
        let counter = 1;
        while (uploadedNames.includes(finalName)) {
          const dotIdx = name.lastIndexOf('.');
          if (dotIdx > 0) {
            finalName = `${name.slice(0, dotIdx)}-${counter}${name.slice(dotIdx)}`;
          } else {
            finalName = `${name}-${counter}`;
          }
          counter++;
        }

        if (rawFiles.length > 1) {
          this.notice.set(`Uploading files (${i + 1}/${rawFiles.length}): “${finalName}”...`);
        } else {
          this.notice.set(`Uploading “${finalName}”...`);
        }

        try {
          const response = await this.http.raw(`/projects/${projectId}/files`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-File-Name': encodeURIComponent(finalName),
            },
            body: file,
            credentials: 'same-origin',
          });
          const body = (await response.json()) as { name?: string; size?: number; error?: string };
          if (!response.ok) {
            throw new Error(body.error || `Failed to upload “${finalName}”`);
          }
          uploadedNames.push(body.name || finalName);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : `Upload error for “${finalName}”`);
        }
      }

      if (uploadedNames.length > 0) {
        this.mentionFiles(uploadedNames);
        this.taskFilesService.filesOpen.set(true);
        await this.taskFilesService.refreshTaskFiles();
        if (uploadedNames.length === 1) {
          this.notice.set(
            `File “${uploadedNames[0]}” added to the project and mentioned in the message`,
          );
        } else {
          this.notice.set(
            `Uploaded ${uploadedNames.length} files to the project and mentioned in the message`,
          );
        }
      }

      if (errors.length > 0) {
        this.error.set(errors.join(' · '));
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to upload files');
    } finally {
      this.uploading.set(false);
    }
  }
  mentionFiles(names: string[]) {
    if (!names.length) return;
    const mentions = names.map((n) => (n.includes(' ') ? `@"${n}"` : `@${n}`)).join(' ');

    const textarea = this.chatViewService.composerTextareaRef?.nativeElement;
    const currentText = this.chatService.draft || '';

    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      let newText = '';
      let newCursorPos = 0;

      if (
        typeof start === 'number' &&
        typeof end === 'number' &&
        (document.activeElement === textarea || start !== end || currentText.length > 0)
      ) {
        const before = currentText.substring(0, start);
        const after = currentText.substring(end);

        const needLeadingSpace = before.length > 0 && !/\s$/.test(before);
        const needTrailingSpace = after.length > 0 && !/^\s/.test(after);

        const inserted = (needLeadingSpace ? ' ' : '') + mentions + (needTrailingSpace ? ' ' : ' ');
        newText = before + inserted + after;
        newCursorPos = (before + inserted).length;
      } else {
        const needLeadingSpace = currentText.length > 0 && !/\s$/.test(currentText);
        newText = currentText + (needLeadingSpace ? ' ' : '') + mentions + ' ';
        newCursorPos = newText.length;
      }

      this.chatService.draft = newText;
      setTimeout(() => {
        this.chatViewService.adjustTextareaHeight();
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 10);
    } else {
      const needLeadingSpace = currentText.length > 0 && !/\s$/.test(currentText);
      this.chatService.draft = currentText + (needLeadingSpace ? ' ' : '') + mentions + ' ';
    }
  }
  uploadFile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const files = input.files;
    void this.uploadFiles(files);
    input.value = '';
  }
}
