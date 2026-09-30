import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { WorkspaceStore } from './core/workspace.store';
import { AuthPageComponent } from './pages/auth-page';
import { WorkspaceShellComponent } from './layout/workspace-shell';
import { ProjectDialogComponent } from './shared/project-dialog';
import { FilePreviewDialogComponent } from './shared/file-preview-dialog';
import { ModelPickerDialogComponent } from './shared/model-picker-dialog';
import { ProjectMembersDialogComponent } from './shared/project-members-dialog';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    AuthPageComponent,
    WorkspaceShellComponent,
    ProjectDialogComponent,
    FilePreviewDialogComponent,
    ModelPickerDialogComponent,
    ProjectMembersDialogComponent,
  ],
  templateUrl: './app.html',
})
export class App implements OnInit, OnDestroy {
  readonly vm = inject(WorkspaceStore);
  ngOnInit() {
    this.vm.ngOnInit();
  }
  ngOnDestroy() {
    this.vm.ngOnDestroy();
  }
}
