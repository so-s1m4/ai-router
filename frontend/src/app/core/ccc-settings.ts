export type CccCandidate = {id:string;enabled:boolean;provider:'codex'|'openrouter'|'antigravity'|'cerebras';accountId?:string;model:string;reasoning:'default'|'none'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';delaySeconds:number;mode:'code'|'agent';fast:boolean;openRouterRouting?:{only:string[];allowFallbacks:boolean}};
export type CccAutoSettings = {version:1;submissionIntervalSeconds:number;rateLimitRetries:number;rateLimitDelaySeconds:number;solutionAttempts:number;preparationRetries:number;optimizationEnabled:boolean;optimizationDelaySeconds:number;reuseThreads:boolean;startLevel:number;endLevel:number|null;extraInstructions:string;levels:{from:number;to:number|null;candidates:CccCandidate[]}[]};
export function defaultCccAutoSettings(): CccAutoSettings {
  return {version:1, submissionIntervalSeconds:1, rateLimitRetries:5, rateLimitDelaySeconds:1,
    solutionAttempts:3, preparationRetries:2, optimizationEnabled:true, optimizationDelaySeconds:10,
    reuseThreads:true, startLevel:1, endLevel:null, extraInstructions:'',
    levels:[1,2,3,4,5].map(from => ({from, to:from === 5 ? null : from,
      candidates: ['low','medium','high'].map((reasoning, i) => ({id:['light','medium','high'][i],
        enabled:true, provider:'codex', model:'gpt-6.1-sol', reasoning:reasoning as 'low'|'medium'|'high',
        delaySeconds:i === 2 ? 20 : 0, mode:'code', fast:true}))}))};
}
