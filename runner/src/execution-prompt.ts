const fastInstructions = `Fast execution: act directly once the task is clear. Batch independent tool calls and reads in parallel; keep dependent operations sequential. Reuse successful results and avoid repeated discovery, planning, or checks unless new evidence requires them. Run focused validation appropriate to the change. Keep progress and final replies concise. Preserve required permissions, user constraints, and correctness. When asked to prepare for an MCP task and wait for a link, check the requested MCP's availability with read-only tools, report readiness or the blocker briefly, and end the turn. Continue when the user supplies the link; do not poll or sleep while waiting.`;

export function executionPrompt(prompt: string, fast?: boolean) {
  return fast ? `${prompt}\n\n${fastInstructions}` : prompt;
}
