import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionWorkflow } from './session-workflow.js';
import type { ChatSession } from './types.js';
import type { QueueTask } from './task-queue.js';
const chat: ChatSession = {id:'chat',title:'Chat',createdAt:'',updatedAt:'',messages:[]};
const task = (sessionId:string,workflow:string,createdAt:string) => ({id:createdAt,userId:'test',input:{sessionId,workflow},createdAt,updatedAt:createdAt,priority:1,state:'completed',message:''}) as QueueTask;
test('stored mode is authoritative and isolated from other chats and later requests', () => {
  const tasks = [task('other','ccc-auto','1'),task('chat','ccc-auto','2')];
  assert.equal(sessionWorkflow({...chat,workflow:'standard'},tasks),'standard');
  assert.equal(sessionWorkflow({...chat,workflow:'ccc-auto'},[]),'ccc-auto');
  assert.equal(sessionWorkflow(chat,[tasks[0]]),'standard');
});
test('legacy chats recover their first recorded workflow', () => {
  assert.equal(sessionWorkflow(chat,[task('chat','standard','2'),task('chat','ccc-auto','1')]),'ccc-auto');
  assert.equal(sessionWorkflow(chat,[task('chat','ccc-auto','2'),task('chat','standard','1')]),'standard');
});
