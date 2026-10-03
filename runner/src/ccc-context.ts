// Keep diagnostics bounded without hiding that a model needs to read the full artifact.
export function boundedText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit < 80) return '[truncated]';
  const marker = '\n[truncated; showing beginning and end]\n';
  const room = Math.max(0, limit - marker.length);
  const head = Math.ceil(room / 2);
  return text.slice(0, head) + marker + text.slice(-(room - head));
}

export function compactFeedback(value: unknown): unknown {
  let remaining = 16000;
  const visit = (item: unknown, depth: number): unknown => {
    if (remaining <= 0 || depth > 12) return '[truncated; read full evaluation artifact]';
    if (typeof item === 'string') {
      const text = boundedText(item, Math.min(4000, remaining));
      remaining -= text.length;
      return text;
    }
    if (Array.isArray(item)) {
      const result: unknown[] = [];
      for (const child of item) {
        if (remaining <= 0) { result.push('[truncated; read full evaluation artifact]'); break; }
        remaining -= 16;
        result.push(visit(child, depth + 1));
      }
      return result;
    }
    if (item && typeof item === 'object') {
      const result: Record<string, unknown> = {};
      // Surface the verdict before verbose case details can use the budget.
      const priority = ['isCorrect', 'evaluationFile', 'sourceDirectory', 'preparationError'];
      const rank = (key: string) => { const index = priority.indexOf(key); return index < 0 ? priority.length : index; };
      const entries = Object.entries(item).sort(([a], [b]) => rank(a) - rank(b));
      for (const [key, child] of entries) {
        if (remaining <= 0) { result.truncated = 'Read full evaluation artifact'; break; }
        remaining -= key.length + 16;
        result[key] = visit(child, depth + 1);
      }
      return result;
    }
    remaining -= 16;
    return item;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return visit(value, 0);
  // Source is executable context, not a diagnostic: never truncate it.
  const { source, ...diagnostics } = value as Record<string, unknown>;
  return { ...(visit(diagnostics, 0) as object), ...(source !== undefined ? { source } : {}) };
}

export function codeContext(context: unknown): string {
  if (!context || typeof context !== 'object') return JSON.stringify(context);
  const value = { ...context } as Record<string, unknown>;
  if (value.evaluationFeedback) value.evaluationFeedback = compactFeedback(value.evaluationFeedback);
  // These fields often contain the very same previous/rejected solver.
  const sources = new Map<string, string>();
  for (const key of ['source', 'currentLightSource']) {
    const source = value[key];
    if (typeof source !== 'string' || !source) continue;
    const previous = sources.get(source);
    if (previous) value[key] = { sameAs: previous };
    else sources.set(source, key);
  }
  for (const key of ['evaluationFeedback', 'previousLevel']) {
    const item = value[key];
    if (!item || typeof item !== 'object') continue;
    const record = { ...item } as Record<string, unknown>;
    const source = record.source;
    if (typeof source === 'string' && source) {
      const previous = sources.get(source);
      if (previous) record.source = { sameAs: previous };
      else sources.set(source, `${key}.source`);
    }
    value[key] = record;
  }
  return JSON.stringify(value);
}
