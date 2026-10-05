import { z } from 'zod';

export const openRouterRoutingSchema = z.object({
  only: z.array(z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/)).max(20),
  allowFallbacks: z.boolean(),
}).strict();
export type OpenRouterRouting = z.infer<typeof openRouterRoutingSchema>;

export const cccCandidateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  enabled: z.boolean(),
  provider: z.enum(['codex', 'openrouter', 'antigravity']),
  accountId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::(?:codex|openrouter|antigravity))?$/i).optional(),
  model: z.string().trim().min(1).max(100),
  reasoning: z.enum(['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  delaySeconds: z.number().min(0).max(3600),
  mode: z.enum(['code', 'agent']),
  fast: z.boolean(),
  openRouterRouting: openRouterRoutingSchema.optional(),
}).strict();
export const cccAutoSchema = z.object({
  version: z.literal(1),
  submissionIntervalSeconds: z.number().min(0).max(300),
  rateLimitRetries: z.number().int().min(0).max(20),
  rateLimitDelaySeconds: z.number().min(1).max(600),
  solutionAttempts: z.number().int().min(1).max(10),
  preparationRetries: z.number().int().min(0).max(5),
  optimizationEnabled: z.boolean(),
  optimizationDelaySeconds: z.number().min(0).max(3600),
  reuseThreads: z.boolean(),
  startLevel: z.number().int().min(1).max(100),
  endLevel: z.number().int().min(1).max(100).nullable(),
  extraInstructions: z.string().max(4000),
  levels: z.array(z.object({
    from: z.number().int().min(1).max(100),
    to: z.number().int().min(1).max(100).nullable(),
    candidates: z.array(cccCandidateSchema).min(1).max(8),
  }).strict()).min(1).max(20),
}).strict().superRefine((v, ctx) => {
  if (v.endLevel !== null && v.endLevel < v.startLevel) ctx.addIssue({code:'custom',message:'End level must follow start level'});
  let next = 1;
  for (const [i, rule] of v.levels.entries()) {
    if (rule.from !== next || (rule.to !== null && rule.to < rule.from) || (rule.to === null && i !== v.levels.length - 1)) ctx.addIssue({code:'custom',message:'Level ranges must cover all levels in order without gaps or overlaps'});
    next = (rule.to ?? 100) + 1;
    if (!rule.candidates.some(c => c.enabled)) ctx.addIssue({code:'custom',message:'Enable at least one candidate per range'});
    if (new Set(rule.candidates.map(c => c.id)).size !== rule.candidates.length) ctx.addIssue({code:'custom',message:'Candidate IDs must be unique within a range'});
  }
  if (v.levels.at(-1)?.to !== null) ctx.addIssue({code:'custom',message:'Last range must include all higher levels'});
});
export type CccAutoSettings = z.infer<typeof cccAutoSchema>;
export type CccCandidate = z.infer<typeof cccCandidateSchema>;
export function defaultCccAutoSettings(): CccAutoSettings {
  return {version:1, submissionIntervalSeconds:1, rateLimitRetries:5, rateLimitDelaySeconds:1,
    solutionAttempts:3, preparationRetries:2, optimizationEnabled:true, optimizationDelaySeconds:10,
    reuseThreads:true, startLevel:1, endLevel:null, extraInstructions:'',
    levels:[1,2,3,4,5].map(from => ({from, to:from === 5 ? null : from,
      candidates: ['low','medium','high'].map((reasoning, i) => ({id:['light','medium','high'][i],
        enabled:true, provider:'codex', model:'gpt-6.1-sol', reasoning:reasoning as 'low'|'medium'|'high',
        delaySeconds:i === 2 ? 20 : 0, mode:'code', fast:true}))}))};
}
