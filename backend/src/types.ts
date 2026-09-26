export type ProviderId = 'codex' | 'antigravity';
export type RunMode = 'chat' | 'task';
export type ReasoningEffort = { id: string; label: string };
export type Model = { id: string; label: string; reasoning?: ReasoningEffort[]; defaultReasoning?: string };
export type AIEventType = 'started' | 'status' | 'delta' | 'tool' | 'fallback' | 'checkpoint' | 'handoff_started' | 'handoff_ready' | 'usage' | 'completed' | 'error';
export interface AIEvent { id: string; sessionId: string; runId: string; at: string; type: AIEventType; provider?: ProviderId; message?: string; text?: string; data?: Record<string, unknown>; }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; at: string; provider?: ProviderId; }
export interface ChatSession { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[]; projectId?: string; }

export const DEFAULT_CODEX_MODELS: Model[] = [
  { id: 'default', label: 'По умолчанию Codex' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'o3', label: 'o3', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'o3-mini', label: 'o3-mini', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'o1', label: 'o1', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] }
];

export const DEFAULT_GEMINI_MODELS: Model[] = [
  { id: 'default', label: 'По умолчанию Gemini' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', defaultReasoning: 'high', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', defaultReasoning: 'high', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', defaultReasoning: 'high', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', defaultReasoning: 'high', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'high', label: 'Высокое' }] },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }, { id: 'max', label: 'Максимальное' }] },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-thinking', label: 'Gemini 2.5 Flash Thinking', reasoning: [{ id: 'low', label: 'Низкое' }, { id: 'medium', label: 'Среднее' }, { id: 'high', label: 'Высокое' }] },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
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
  antigravity: mergeModelCatalog(DEFAULT_GEMINI_MODELS, parseCustomModels(process.env.AGY_MODELS))
};

export function resolveAccountModels(provider: ProviderId, reportedModels?: Model[]): Model[] {
  const catalog = modelCatalog[provider] || [];
  if (!reportedModels?.length) return catalog;
  const map = new Map<string, Model>();
  for (const m of catalog) map.set(m.id, m);
  for (const m of reportedModels) map.set(m.id, m);
  return [...map.values()];
}
