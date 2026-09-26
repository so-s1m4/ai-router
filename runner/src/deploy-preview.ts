import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import path from 'node:path';

const args=process.argv.slice(2);
const usage='Использование: deploy-preview <папка-сайта> [поддомен] | deploy-preview --port <порт> [поддомен] | deploy-preview --stop <поддомен> | deploy-preview --list';
if(!args.length){console.error(usage);process.exit(2);}
const subdomain=(value?:string)=>value||`preview-${randomBytes(4).toString('hex')}`;
let command:Record<string,unknown>;
if(args[0]==='--list')command={action:'list'};
else if(args[0]==='--stop'&&args[1])command={action:'stop',subdomain:args[1]};
else if(args[0]==='--port'&&args[1])command={action:'publish',subdomain:subdomain(args[2]),target:{kind:'port',port:Number(args[1])}};
else if(!args[0].startsWith('--'))command={action:'publish',subdomain:subdomain(args[1]),target:{kind:'static',root:path.resolve(args[0])}};
else{console.error(usage);process.exit(2);}
const socket=createConnection(path.join(process.env.RUNNER_DATA_DIR||'/runner-data','preview-control.sock'));
let buffer='';const timeout=setTimeout(()=>{console.error('Runner не ответил');socket.destroy();process.exitCode=1;},15000);
socket.on('connect',()=>socket.write(JSON.stringify(command)+'\n'));
socket.on('data',(chunk:Buffer)=>{buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;clearTimeout(timeout);socket.end();try{const answer=JSON.parse(buffer.slice(0,buffer.indexOf('\n'))) as {ok:boolean;url?:string;error?:string;visible?:boolean;expiresAt?:string;sites?:string[]};if(!answer.ok){console.error(answer.error||'Не удалось опубликовать превью');process.exitCode=1;}else if(answer.sites)console.log(answer.sites.join('\n')||'Нет опубликованных сайтов');else if(answer.url){console.log(answer.url);if(answer.visible===false)console.log('Сайт скрыт. Включите видимость во вкладке «Сайты» на ai.s1m4.com.');}else console.log('Превью остановлено');}catch{console.error('Неверный ответ runner');process.exitCode=1;}});
socket.on('error',error=>{clearTimeout(timeout);console.error('Не удалось подключиться к runner:',error.message);process.exitCode=1;});
