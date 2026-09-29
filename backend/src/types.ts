export type ProviderId = 'codex' | 'antigravity' | 'chatgpt';
export type RunMode = 'chat' | 'task';
export type ReasoningEffort = { id: string; label: string };
export type Model = { id: string; label: string; reasoning?: ReasoningEffort[]; defaultReasoning?: string };
export type AIEventType = 'started' | 'status' | 'delta' | 'tool' | 'fallback' | 'checkpoint' | 'handoff_started' | 'handoff_ready' | 'usage' | 'completed' | 'error';
export interface AIEvent { id: string; sessionId: string; runId: string; at: string; type: AIEventType; provider?: ProviderId; message?: string; text?: string; data?: Record<string, unknown>; }
export interface TokenUsage { totalTokens: number; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningOutputTokens?: number; }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; at: string; provider?: ProviderId; tokenUsage?: TokenUsage; }
export interface ChatSession { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[]; projectId?: string; runnerId?: string; }

export const DEFAULT_CODEX_MODELS: Model[] = [
  { id: 'default', label: 'По умолчанию Codex' }
];

export const DEFAULT_GEMINI_MODELS: Model[] = [
  { id: 'default', label: 'По умолчанию Gemini' }
];

export const DEFAULT_CHATGPT_MODELS: Model[] = [
  { id: 'default', label: 'По умолчанию ChatGPT' }
];

function parseCustomModels(raw: string | undefined): Model[] {
  return (raw || '').split(',').map(x => x.trim()).filter(Boolean).map(x => ({ id: x, label: x }));
}

function mergeModelCatalog(defaults: Model[], custom: Model[]): Model[] {
  const map = new Map<string, Model>();
  for (const m of defaults) map.set(m.id, m);
  for (const m of custom) {
    if (!map.has(m.id)) map.set(m.id, m);
  }
  return [...map.values()];
}

export const modelCatalog: Record<ProviderId, Model[]> = {
  codex: mergeModelCatalog(DEFAULT_CODEX_MODELS, parseCustomModels(process.env.CODEX_MODELS)),
  antigravity: mergeModelCatalog(DEFAULT_GEMINI_MODELS, parseCustomModels(process.env.AGY_MODELS)),
  chatgpt: DEFAULT_CHATGPT_MODELS
};

export function resolveAccountModels(provider: ProviderId, reportedModels?: Model[]): Model[] {
  const catalog = modelCatalog[provider] || [];
  if (!reportedModels) return catalog;
  const map = new Map<string, Model>();
  map.set('default', catalog.find(m => m.id === 'default') || { id: 'default', label: 'По умолчанию аккаунта' });
  for (const m of reportedModels) map.set(m.id, m);
  return [...map.values()];
}
