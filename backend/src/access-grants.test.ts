import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('grant budgets, permissions, monthly reset, concurrent leases and durable charges', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'router-grants-'));
  process.env.DATA_DIR=root;
  const {createGrant,listGrants,updateGrant,acquireGrant,releaseGrant,chargeGrant,grantSnapshot}=await import('./access-grants.js');
  try {
    const grant=await createGrant({ownerId:'owner',ownerName:'admin',recipientId:'friend',recipientName:'friend',accountId:'account',accountName:'Codex',models:['allowed'],budget:100,period:'monthly'});
    assert.equal(await acquireGrant('friend',grant.id,'allowed'),null);
    assert.equal(await updateGrant('stranger',grant.id,{state:'active'}),null);
    assert.equal(await updateGrant('friend',grant.id,{budget:999}),null);
    assert.equal(await updateGrant('owner',grant.id,{state:'active'}),null);
    await updateGrant('friend',grant.id,{state:'active'});
    assert.equal(await acquireGrant('friend',grant.id,'default'),null);
    const leases=await Promise.all([acquireGrant('friend',grant.id,'allowed'),acquireGrant('friend',grant.id,'allowed')]);
    assert.equal(leases.filter(Boolean).length,1);
    await Promise.all([chargeGrant(grant.id,'allowed',80),chargeGrant(grant.id,'allowed',40)]);
    releaseGrant(grant.id);
    assert.equal(await acquireGrant('friend',grant.id,'allowed'),null);
    const saved=(await listGrants('owner'))[0];
    assert.equal(saved.usedTokens,120);assert.equal(saved.lifetimeTokens,120);assert.deepEqual(saved.usageByModel,{allowed:120});
    const nextMonth=grantSnapshot({...saved,month:'2020-01'},new Date('2020-02-01T00:00:00Z'));
    assert.equal(nextMonth.usedTokens,0);assert.equal(nextMonth.lifetimeTokens,120);assert.deepEqual(nextMonth.usageByModel,{});
    assert.equal(grantSnapshot({...saved,period:'once',month:'2020-01'},new Date('2020-02-01T00:00:00Z')).usedTokens,120);
    await updateGrant('owner',grant.id,{budget:200});assert.ok(await acquireGrant('friend',grant.id,'allowed'));releaseGrant(grant.id);
    await updateGrant('owner',grant.id,{state:'revoked'});assert.equal(await acquireGrant('friend',grant.id,'allowed'),null);
    assert.equal((await listGrants('stranger')).length,0);
  } finally {await rm(root,{recursive:true,force:true});}
});
