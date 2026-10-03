import { ownerGuard } from './core/owner.guard';
import { Routes } from '@angular/router';
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'projects' },
  {
    path: 'chats',
    title: 'Chats · AI Router',
    loadComponent: () => import('./pages/chat-page').then((m) => m.ChatPageComponent),
  },
  {
    path: 'files',
    title: 'Files · AI Router',
    loadComponent: () => import('./pages/files-page').then((m) => m.FilesPageComponent),
  },
  {
    path: 'usage',
    title: 'Usage · AI Router',
    loadComponent: () => import('./pages/usage-page').then((m) => m.UsagePageComponent),
  },
  {
    path: 'notifications',
    title: 'Notifications · AI Router',
    loadComponent: () =>
      import('./pages/notifications-page').then((m) => m.NotificationsPageComponent),
  },
  {
    path: 'projects',
    title: 'Projects · AI Router',
    loadComponent: () => import('./pages/projects-page').then((m) => m.ProjectsPageComponent),
  },
  {
    path: 'sites',
    title: 'Sites · AI Router',
    loadComponent: () => import('./pages/sites-page').then((m) => m.SitesPageComponent),
  },
  {
    path: 'models',
    title: 'Models · AI Router',
    loadComponent: () => import('./pages/models-page').then((m) => m.ModelsPageComponent),
  },
  {
    path: 'accounts',
    title: 'Accounts · AI Router',
    loadComponent: () => import('./pages/accounts-page').then((m) => m.AccountsPageComponent),
  },
  {
    path: 'users',
    canActivate: [ownerGuard],
    title: 'Users · AI Router',
    loadComponent: () => import('./pages/users-page').then((m) => m.UsersPageComponent),
  },
  {
    path: 'runners',
    title: 'Runners · AI Router',
    loadComponent: () => import('./pages/runners-page').then((m) => m.RunnersPageComponent),
  },
  {path:'ccc-auto',title:'CCC-Auto · AI Router',loadComponent:()=>import('./pages/ccc-auto-page').then(m=>m.CccAutoPageComponent)},
  { path: '**', redirectTo: 'projects' },
];
