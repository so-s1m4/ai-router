import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AccountUsageManager} from './usage.js';

test('reset credits are account scoped and survive window updates; unavailable is distinct from zero',()=>{
 const usage=new AccountUsageManager();
 assert.equal(usage.snapshot('u','a').resetCredits,null);
 usage.update('u','a',{resetCredits:{availableCount:2,credits:null}});
 usage.update('u','a',{primary:{usedPercent:100}});
 assert.equal(usage.snapshot('u','a').resetCredits?.availableCount,2);
 assert.equal(usage.available('u','a'),false,'available resets do not automatically redeem themselves');
 assert.equal(usage.snapshot('other','a').resetCredits,null);
 usage.update('u','a',{resetCredits:{availableCount:0,credits:[]}});
 assert.equal(usage.snapshot('u','a').resetCredits?.availableCount,0);
 usage.update('u','a',{resetCredits:null});
 assert.equal(usage.snapshot('u','a').resetCredits,null);
 usage.rateLimited('u','a');usage.clearCooldown('u','a');
 assert.equal(usage.snapshot('u','a').cooldownUntil,null);
 assert.equal(usage.available('u','a'),false,'clearing cooldown must not fabricate refreshed quota');
});
