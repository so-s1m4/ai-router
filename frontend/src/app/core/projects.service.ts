import { inject, Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Project } from './models';

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private readonly http = inject(ApiService);

  projectCreateOpen = signal(false);
  projectSaving = signal(false);
  projectCreateError = signal('');
  newProjectName = '';
  newProjectRunner = '';
  newProjectShared = false;
  newProjectMembers = '';
  membersProject = signal<Project | null>(null);
  membersCanManage = signal(false);
  membersLoading = signal(false);
  membersSaving = signal(false);
  membersError = signal('');
  projectMembers = signal<{ id: string; username: string; owner: boolean }[]>([]);
  editProjectMembers = '';
  projects = signal<Project[]>([]);
  selectedProjectId = signal('');
  closeProjectDialog() {
    if (!this.projectSaving()) this.projectCreateOpen.set(false);
  }
  memberNames(value: string) {
    return [
      ...new Set(
        value
          .split(/[\s,;]+/)
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
  }
  async showProjectMembers(project: Project) {
    this.membersProject.set(project);
    this.membersLoading.set(true);
    this.membersError.set('');
    this.projectMembers.set([]);
    this.membersCanManage.set(false);
    this.editProjectMembers = '';
    try {
      const result = await this.http.request<{
        members: { id: string; username: string; owner: boolean }[];
        canManage: boolean;
      }>('/projects/' + project.id + '/members');
      this.projectMembers.set(result.members);
      this.membersCanManage.set(result.canManage);
      this.editProjectMembers = result.members
        .filter((m) => !m.owner)
        .map((m) => m.username)
        .join(', ');
    } catch (e) {
      this.membersError.set((e as Error).message);
    } finally {
      this.membersLoading.set(false);
    }
  }
  closeMembersDialog() {
    if (!this.membersSaving()) this.membersProject.set(null);
  }
  async saveProjectMembers() {
    const project = this.membersProject();
    if (!project || !this.membersCanManage() || this.membersSaving()) return;
    this.membersSaving.set(true);
    this.membersError.set('');
    try {
      const updated = await this.http.request<Project>('/projects/' + project.id + '/members', {
        method: 'PUT',
        body: JSON.stringify({ members: this.memberNames(this.editProjectMembers) }),
      });
      this.projects.update((list) => list.map((p) => (p.id === updated.id ? updated : p)));
      this.membersProject.set(null);
    } catch (e) {
      this.membersError.set((e as Error).message);
    } finally {
      this.membersSaving.set(false);
    }
  }
}
