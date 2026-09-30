import assert from 'node:assert/strict';
import test from 'node:test';
import {parseResetCredits} from '../dist/reset-credits.js';

test('reset count remains authoritative with missing or capped details',()=>{
 assert.equal(parseResetCredits(null),null);
 assert.equal(parseResetCredits({availableCount:null}),null);
 assert.equal(parseResetCredits({availableCount:-1}),null);
 assert.deepEqual(parseResetCredits({availableCount:0,credits:[]}),{availableCount:0,credits:[]});
 assert.deepEqual(parseResetCredits({availableCount:3,credits:null}),{availableCount:3,credits:null});
 const parsed=parseResetCredits({availableCount:5,credits:[
  {id:'unlimited',status:'available',expiresAt:null,title:'Referral'},
  {id:'soon',status:'available',expiresAt:1800000000,title:null},
  {id:'redeemed',status:'redeemed',expiresAt:null},
  {id:'invalid',status:'available',expiresAt:1e100}
 ]});
 assert.equal(parsed.availableCount,5);
 assert.deepEqual(parsed.credits,[{id:'soon',expiresAt:new Date(1800000000000).toISOString(),title:null},{id:'unlimited',expiresAt:null,title:'Referral'}]);
});
