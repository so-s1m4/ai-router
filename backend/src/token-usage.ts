import type { TokenUsage } from './types.js';

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

// Usage events contain snapshots, not increments. Cached input and reasoning
// output are subsets of input/output and must not be added to the total again.
export function normalizeTokenUsage(data?: Record<string, unknown>): TokenUsage | undefined {
  if (!data) return undefined;
  const inputTokens = count(data.inputTokens ?? data.input_tokens ?? data.prompt_tokens ?? data.promptTokenCount);
  const outputTokens = count(data.outputTokens ?? data.output_tokens ?? data.completion_tokens ?? data.candidatesTokenCount);
  const totalTokens = count(data.totalTokens ?? data.total_tokens ?? data.totalTokenCount)
    ?? (inputTokens !== undefined && outputTokens !== undefined ? count(inputTokens + outputTokens) : undefined);
  if (totalTokens === undefined) return undefined;
  const cachedInputTokens = count(data.cachedInputTokens ?? data.cached_input_tokens);
  const reasoningOutputTokens = count(data.reasoningOutputTokens ?? data.reasoning_output_tokens);
  return {
    totalTokens,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {})
  };
}

export function sumTokenUsage(usages: Iterable<TokenUsage>): TokenUsage | undefined {
  const rows = [...usages];
  if (!rows.length) return undefined;
  const totalTokens = rows.reduce((total, row) => total + row.totalTokens, 0);
  const result: TokenUsage = { totalTokens };
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningOutputTokens'] as const) {
    if (rows.every(row => row[key] !== undefined)) result[key] = rows.reduce((total, row) => total + row[key]!, 0);
  }
  return result;
}
