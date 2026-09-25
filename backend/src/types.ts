export type ProviderId = 'codex' | 'antigravity';
export type RunMode = 'chat' | 'task';
export type Model = {id:string;label:string};
export type AIEventType = 'started' | 'status' | 'delta' | 'tool' | 'fallback' | 'usage' | 'completed' | 'error';
export interface AIEvent { id:string; sessionId:string; runId:string; at:string; type:AIEventType; provider?:ProviderId; message?:string; text?:string; data?:Record<string,unknown>; }
export interface Message { id:string; role:'user'|'assistant'; text:string; at:string; provider?:ProviderId; }
export interface ChatSession { id:string; title:string; createdAt:string; updatedAt:string; messages:Message[]; projectId?:string; }
export const modelCatalog:Record<ProviderId,Model[]> = {
  codex:[{id:'default',label:'По умолчанию CLI'},...((process.env.CODEX_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>({id:x,label:x})))],
  antigravity:[{id:'default',label:'По умолчанию CLI'},...((process.env.AGY_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>({id:x,label:x})))]
};
