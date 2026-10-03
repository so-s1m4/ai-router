import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { userDir, prepareUser } from './store.js';
import { cccAutoSchema, defaultCccAutoSettings, type CccAutoSettings } from './ccc-settings.js';
const file = (userId:string) => path.join(userDir(userId), 'ccc-auto.json');
export async function readCccSettings(userId:string):Promise<CccAutoSettings> {
  try {return cccAutoSchema.parse(JSON.parse(await readFile(file(userId),'utf8')));}
  catch(error) {if((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultCccAutoSettings(); throw error;}
}
let tail = Promise.resolve();
export function saveCccSettings(userId:string, settings:CccAutoSettings) {
  const task = tail.then(async () => {await prepareUser(userId); const target=file(userId); await mkdir(path.dirname(target),{recursive:true}); await writeFile(target+'.tmp',JSON.stringify(settings,null,2),{mode:0o600}); await rename(target+'.tmp',target);});
  tail=task.catch(()=>{});return task;
}
