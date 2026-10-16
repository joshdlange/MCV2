import { test } from "node:test";
import assert from "node:assert/strict";
import { completeValueScout } from "../pricing/value-scout";
import { DEFAULT_BADGE_XP } from "../../shared/xp";

test("Value Scout accepts explicit legitimate refresh states, not empty, gated or in-flight responses",async()=>{
  let calls=0;
  const actions={award:async()=>{calls++;}};
  for(const state of [{avgPrice:null},{avgPrice:0},{avgPrice:60,upgradeRequired:true},{avgPrice:60,refreshing:true}])
    await completeValueScout(1,state,actions);
  assert.equal(calls,0);
  for(const source of ["SOLDGRAPH_SOLD_COMPS","SOLDGRAPH_LIMITED_DATA","LEGACY_ACTIVE_ESTIMATE"])
    await completeValueScout(1,{avgPrice:60,source},actions);
  assert.equal(calls,3);
  assert.equal(DEFAULT_BADGE_XP.bronze,10);
});
test("Repeated refreshes use the existing idempotent badge-award contract",async()=>{
  const earned=new Set<number>();
  let notifications=0;
  const actions={award:async(user:number)=>{if(!earned.has(user)){earned.add(user);notifications++;}}};
  await Promise.all(Array.from({length:10},()=>completeValueScout(1,{avgPrice:60},actions)));
  assert.equal(earned.size,1);assert.equal(notifications,1);
});
