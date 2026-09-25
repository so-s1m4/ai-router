import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { dataRoot } from './store.js';
export interface User { id:string; username:string; passwordHash:string; createdAt:string; }
const file=path.join(dataRoot,'users.json');
let queue=Promise.resolve();
async function read():Promise<User[]>{try{return JSON.parse(await readFile(file,'utf8')) as User[];}catch{return [];}}
async function write(users:User[]){await mkdir(dataRoot,{recursive:true,mode:0o700});const temp=file+'.tmp';await writeFile(temp,JSON.stringify(users,null,2),{mode:0o600});await rename(temp,file);}
export async function findUserByName(username:string){return (await read()).find(u=>u.username===username.toLowerCase())||null;}
export async function findUserById(id:string){return (await read()).find(u=>u.id===id)||null;}
export function registerUser(username:string,password:string):Promise<User>{const task=queue.then(async()=>{const users=await read();const name=username.toLowerCase();if(users.some(u=>u.username===name))throw new Error('Такой логин уже существует');const user={id:randomUUID(),username:name,passwordHash:await bcrypt.hash(password,12),createdAt:new Date().toISOString()};users.push(user);await write(users);return user;});queue=task.then(()=>undefined,()=>undefined);return task;}
export async function ensureAdmin(username:string,password:string){const users=await read();const name=username.toLowerCase();const found=users.find(u=>u.id==='owner');const hash=await bcrypt.hash(password,12);if(found){found.username=name;found.passwordHash=hash;}else users.push({id:'owner',username:name,passwordHash:hash,createdAt:new Date().toISOString()});await write(users);}
export async function verifyPassword(user:User|null,password:string){return user?bcrypt.compare(password,user.passwordHash):false;}
