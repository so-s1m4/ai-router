import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
export type QueueTask = { id:string; userId:string; input:Record<string,unknown>; createdAt:string; priority:number; state:'queued'|'running'|'completed'|'error'|'canceled'; message:string; updatedAt:string };
export class TaskQueue {
  private rows:QueueTask[]=[];
  private writes:Promise<void>=Promise.resolve();
  constructor(private file:string){}
  async load(){
    try{this.rows=JSON.parse(await readFile(this.file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    for(const row of this.rows)if(row.state==='running'){row.state='error';row.message='Server restarted during execution. Review the chat before submitting again.';}
    await this.save();
  }
  list(userId?:string){return this.rows.filter(t=>!userId||t.userId===userId).sort((a,b)=>b.priority-a.priority||a.createdAt.localeCompare(b.createdAt)).map(t=>({...t}));}
  async add(task:QueueTask){if(this.rows.filter(t=>t.userId===task.userId&&t.state==='queued').length>=100)throw new Error('Queue limit: 100 waiting tasks');this.rows.push(task);await this.save();}
  async update(id:string,patch:Partial<Pick<QueueTask,'state'|'message'|'priority'>>){const row=this.rows.find(t=>t.id===id);if(!row)return;if(Object.entries(patch).every(([key,value])=>row[key as keyof QueueTask]===value))return;Object.assign(row,patch,{updatedAt:new Date().toISOString()});await this.save();}
  private save(){const snapshot=JSON.stringify(this.rows.filter(t=>t.state==='queued'||t.state==='running').concat(this.rows.filter(t=>t.state!=='queued'&&t.state!=='running').slice(-500)));this.writes=this.writes.catch(()=>{}).then(async()=>{await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});await writeFile(this.file+'.tmp',snapshot,{mode:0o600});await rename(this.file+'.tmp',this.file);});return this.writes;}
}
