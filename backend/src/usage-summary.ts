import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatSession, TokenUsage } from './types.js';
type RecordRow={userId:string;runId:string;attemptId?:string;accountId:string;projectId?:string;model:string;provider:string;tokens:TokenUsage};
export class UsageLedger {
  private records:RecordRow[]=[];
  private writes=Promise.resolve();
  constructor(private file:string){}
  async load(){try{this.records=JSON.parse(await readFile(this.file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  record(row:RecordRow){const index=this.records.findIndex(r=>r.runId===row.runId&&r.accountId===row.accountId&&r.attemptId===row.attemptId);if(index<0)this.records.push(row);else this.records[index]=row;const snapshot=JSON.stringify(this.records);this.writes=this.writes.catch(()=>{}).then(async()=>{await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});await writeFile(this.file+'.tmp',snapshot,{mode:0o600});await rename(this.file+'.tmp',this.file);});return this.writes;}
  summary(userId:string,sessions:ChatSession[]){const rows=this.records.filter(r=>r.userId===userId);const known=new Set(rows.map(r=>r.runId));for(const chat of sessions)for(const message of chat.messages)if(message.role==='assistant'&&message.tokenUsage&&(!message.runId||!known.has(message.runId)))rows.push({userId,runId:message.id,accountId:message.accountId||'unknown',projectId:chat.projectId,model:message.model||'Unknown (older requests)',provider:message.provider||'unknown',tokens:message.tokenUsage});const group=(key:(r:RecordRow)=>string)=>{const totals=new Map<string,number>();for(const row of rows){const id=key(row);totals.set(id,(totals.get(id)||0)+row.tokens.totalTokens);}return [...totals].map(([id,tokens])=>({id,tokens})).sort((a,b)=>b.tokens-a.tokens);};return {totalTokens:rows.reduce((n,r)=>n+r.tokens.totalTokens,0),byProject:group(r=>r.projectId||'no-project'),byModel:group(r=>r.model),byProvider:group(r=>r.provider),source:'Reported token usage; requests without provider usage are excluded'};}
}
