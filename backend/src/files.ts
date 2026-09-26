import { randomUUID } from 'node:crypto';
import { runnerSocket } from './runners.js';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function uploadProjectFile(runnerId: string, projectId: string, name: string, data: Buffer): Promise<{name:string;size:number}> {
  if (data.length > MAX_FILE_BYTES) return Promise.reject(new Error('Файл больше 20 МБ'));
  const socket = runnerSocket(runnerId);
  if (!socket) return Promise.reject(new Error('Исполнитель не в сети'));
  const transferId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Исполнитель не подтвердил загрузку')), 30_000);
    const done = (ack: {ok?:boolean;error?:string;name?:string;size?:number}) => {
      clearTimeout(timer);
      if (ack?.ok && typeof ack.name === 'string' && typeof ack.size === 'number') resolve({name:ack.name,size:ack.size});
      else reject(new Error(ack?.error || 'Не удалось сохранить файл'));
    };
    socket.emit('file:write', {transferId, projectId, name, data}, done);
  });
}
