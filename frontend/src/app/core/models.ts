export type ProviderId = 'codex' | 'antigravity' | 'chatgpt' | 'openrouter';
export type ServiceId = 'auto' | 'gemini' | 'codex' | 'chatgpt' | 'openrouter';
export type ReasoningEffort = { id: string; label: string };
export type Model = {
  id: string;
  label: string;
  reasoning?: ReasoningEffort[];
  defaultReasoning?: string;
};

export const DEFAULT_CODEX_MODELS: Model[] = [{ id: 'default', label: 'Codex default' }];

export const DEFAULT_GEMINI_MODELS: Model[] = [{ id: 'default', label: 'Gemini default' }];

export const DEFAULT_CHATGPT_MODELS: Model[] = [{ id: 'default', label: 'ChatGPT default' }];
export type UsageWindow = {
  usedPercent: number;
  remainingPercent: number;
  windowMinutes: number | null;
  resetAt: string | null;
};
export type ResetCredits = {
  availableCount: number;
  credits: { id: string; expiresAt: string | null; title: string | null }[] | null;
};
export type Account = {
  shared?: boolean;
  id: string;
  provider: ProviderId;
  name: string;
  runnerId?: string;
  priority?: 0 | 1 | 2;
  authType?: 'api_key';
  models: Model[];
  mode: 'runner' | 'offline' | 'unassigned';
  auth: string;
  detail: string;
  limit: {
    resetCredits?: ResetCredits | null;
    source: 'provider' | 'unknown';
    primary: UsageWindow | null;
    secondary: UsageWindow | null;
    cooldownUntil: string | null;
    updatedAt: string | null;
  };
};
export type QueueTask = {
  id: string;
  input: { sessionId: string; prompt: string; model: string; service?: string };
  createdAt: string;
  updatedAt: string;
  priority: number;
  state: string;
  message: string;
  startedAt?: string;
  lastActivityAt?: string;
  activity?: RunActivity[];
  resumedBy?: string;
  recovery?: {
    checkpoint: boolean;
    updatedAt: string;
    partialText: string;
    activity: RunActivity[];
  };
};
export type UsageSummary = {
  totalTokens: number;
  source: string;
  byProject: { id: string; tokens: number }[];
  byModel: { id: string; tokens: number }[];
  byProvider: { id: string; tokens: number }[];
  accounts: Account[];
  grants: (AccessGrant & { remainingTokens: number })[];
  projects: { id: string; name: string }[];
};
export type AccessGrant = {
  id: string;
  direction: 'outgoing' | 'incoming';
  ownerName: string;
  recipientName: string;
  models: string[];
  budget: number;
  period: 'once' | 'monthly';
  state: 'pending' | 'active' | 'revoked';
  usedTokens: number;
  lifetimeTokens: number;
  usageByModel: Record<string, number>;
};
export type Runner = {
  id: string;
  name: string;
  online: boolean;
  managementOnline: boolean;
  createdAt: string;
  revokedAt?: string;
};
export type Project = {
  id: string;
  name: string;
  runnerId: string;
  createdAt: string;
  updatedAt: string;
  shared?: boolean;
  ownerId?: string;
  memberIds?: string[];
};
export type Preview = {
  subdomain: string;
  runnerId: string;
  visible: boolean;
  online: boolean;
  expired: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};
export type Pairing = { code: string; expiresAt: string };
export type TokenUsage = {
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
};
export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  at?: string;
  provider?: ProviderId | string;
  tokenUsage?: TokenUsage;
  steps?: any[];
  [key: string]: any;
};
export type ChatSession = {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
  projectId?: string;
};

export function getSessionLastMessageTime(sess: ChatSession): number {
  if (sess.messages && sess.messages.length > 0) {
    for (let i = sess.messages.length - 1; i >= 0; i--) {
      const at = sess.messages[i]?.at;
      if (at) {
        const t = new Date(at).getTime();
        if (!isNaN(t) && t > 0) return t;
      }
    }
  }
  const fallback = new Date(sess.updatedAt || 0).getTime();
  return isNaN(fallback) ? 0 : fallback;
}

export function sortSessions(list: ChatSession[]): ChatSession[] {
  return [...list]
    .filter((s) => !!s && Array.isArray(s.messages) && s.messages.length > 0)
    .sort((a, b) => getSessionLastMessageTime(b) - getSessionLastMessageTime(a));
}
export type FileGroup = {
  kind: 'projects' | 'sessions';
  id: string;
  title: string;
  runnerId: string;
  files: { name: string; size: number; modified: string }[];
  error?: string;
};
export type AIEvent = {
  at?: string;
  id: string;
  sessionId: string;
  runId: string;
  type: string;
  provider?: ProviderId;
  message?: string;
  text?: string;
  data?: {
    accountId?: string;
    state?: string;
    steeringAvailable?: boolean;
    steeringMessage?: Message;
  };
};
export type RunActivity = {
  type: string;
  message: string;
  at: string;
  provider?: ProviderId;
  accountId?: string;
};
export type RunState =
  | {
      lastActivityAt?: string;
      runId: string;
      sessionId: string;
      startedAt: string;
      accountId?: string;
      provider?: ProviderId;
      message: string;
      stream: string;
      activity: RunActivity[];
      steeringAvailable?: boolean;
    }
  | {
      runId: string;
      sessionId: string;
      type: 'completed' | 'error';
      message: string;
      finishedAt: number;
    };

export interface FlatFileNode {
  name: string;
  path: string;
  isDir: boolean;
  depth: number;
  size: number;
  modified?: string;
  fileCount?: number;
  isExpanded?: boolean;
}

export interface FileNodeInternal {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified?: string;
  fileCount: number;
  children: Map<string, FileNodeInternal>;
}
