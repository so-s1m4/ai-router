import type { Model } from './types.js';

export type Complexity = 'simple' | 'complex';
// Deterministic and local: routing itself never incurs a model call.
export function taskComplexity(prompt: string, history: string = ''): Complexity {
  const text = `${history.slice(-4000)}\n${prompt}`;
  return prompt.length > 1200 || /архитектур|миграци|рефактор|безопасност|уязвим|расслед|оптимизац|разверн|депло|производительност|architecture|migration|refactor|security|vulnerab|investigat|optimi[sz]|deploy|concurren|race condition|implement|реализ|добав|созда|исправ|почини|debug|fix\b|build\b/i.test(text) || prompt.split(/\n\s*[-*\d]/).length > 3 ? 'complex' : 'simple';
}
export function modelTier(id: string): 'cheap' | 'strong' | 'standard' {
  const configured = (key: string) => (process.env[key] || '').split(',').map(x => x.trim()).filter(Boolean);
  if (configured('AUTO_CHEAP_MODELS').includes(id)) return 'cheap';
  if (configured('AUTO_STRONG_MODELS').includes(id)) return 'strong';
  if (/mini|nano|flash|lite|haiku|luna/i.test(id)) return 'cheap';
  if (/pro|opus|astra|sol|o[134](?:-|$)|gpt-[456](?:[.-]|$)/i.test(id)) return 'strong';
  return 'standard';
}
export function modelRank(id: string, complexity: Complexity): number {
  if (id === 'default') return 3;
  const tier = modelTier(id);
  return complexity === 'simple' ? ({cheap:0,standard:1,strong:2})[tier] : ({strong:0,standard:1,cheap:2})[tier];
}
export function automaticModels(models: Model[], blacklist: string[], complexity: Complexity): string[] {
  const blocked = new Set(blacklist);
  return [...new Set(models.map(m => m.id))].filter(id => id !== 'auto' && !blocked.has(id))
    .sort((a,b) => modelRank(a,complexity)-modelRank(b,complexity));
}

// Fast accelerates service, without reducing the model's reasoning effort.
export function requestedReasoning(model: Model | undefined, reasoning: string, fast: boolean): string {
  if (!fast || reasoning !== 'default') return reasoning;
  return model?.defaultReasoning || reasoning;
}
