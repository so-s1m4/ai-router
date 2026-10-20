import { CommonModule } from '@angular/common';
import { Component,inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
LucideBot,
LucideCheck,
LucideGlobe2,
LucideInfo,
LucideSearch,
LucideSparkles,
LucideX,
} from '@lucide/angular';
import { Model } from '../core/models';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'app-models-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideInfo,
    LucideX,
    LucideSearch,
    LucideCheck,
    LucideSparkles,
    LucideBot,
    LucideGlobe2,
  ],
  templateUrl: './models-page.html',
  host: { style: 'display: contents' },
})
export class ModelsPageComponent {
  readonly vm = inject(WorkspaceStore);
  readonly expandedProviders = signal<Set<string>>(new Set());

  showAllModels(provider: string) {
    return this.expandedProviders().has(provider) ||
      !!this.vm.modelService.providerModelSearch().trim() ||
      this.vm.modelService.providerModelFilter() !== 'all';
  }

  visibleModels(provider: string, models: Model[]) {
    return this.showAllModels(provider) ? models : models.slice(0, 5);
  }

  toggleProvider(provider: string) {
    this.expandedProviders.update(current => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }
}
