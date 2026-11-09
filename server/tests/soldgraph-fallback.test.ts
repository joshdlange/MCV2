import {test} from "node:test";
import assert from "node:assert/strict";
import {SoldgraphCache} from "../pricing/soldgraph-cache";
for (const mode of ["empty", "budget_denied", "identity_with_offer", "fallback_failure"]) test(`bounded refresh: ${mode}`,async()=>{
  let reservations=0,charges=0,calls=0,saved:any;
  const card={id:1,name:"Blade",cardNumber:"39",year:2024,parent:"2024 Topps Chrome Marvel",subset:"Blue Wave",variation:null,siblings:[]};
  const db={release(){},async query(sql:string,params:any[]=[]):Promise<any>{
    if(sql.includes("pg_try_advisory_lock"))return {rows:[{locked:true}]};
    if(sql.includes('c.card_number AS'))return {rows:[card]};
    if(sql.includes("SELECT q.*"))return {rows:[{remaining:500,reserve:100,spent:reservations,captured_at:new Date()}]};
    if(sql.includes("AS total"))return {rows:[{total:reservations,daily:mode==="budget_denied" && reservations ? 999999 : reservations}]};
    if(sql.includes("SELECT plan"))return {rows:[{plan:"SIDE_KICK",is_admin:false}]};
    if(sql.includes("consumed=consumed+1")){charges++;return {rows:[{}],rowCount:1};}
    if(sql.includes("INSERT INTO soldgraph_request_budget"))reservations++;
    if(sql.includes("SET query=$2,result="))saved=JSON.parse(params[2]);
    return {rows:[],rowCount:1};
  }};
  const pool={...db,connect:async()=>db};
  const client={search:async()=>{
    calls++;
    if(mode==="fallback_failure" && calls===2)throw new Error("network");
    return {data:mode==="identity_with_offer"?[{
      id:"1",title:"2024 Topps Chrome Marvel Blade #39 Blue Wave /150",best_offer_accepted:true,
    }]:[]};
  }};
  await new SoldgraphCache(pool as any,client as any).refresh(1,1);
  const expected=["budget_denied","identity_with_offer"].includes(mode)?1:2;
  assert.equal(calls,expected);assert.equal(reservations,expected);assert.equal(charges,1);
  assert.equal(saved.attemptedQueries.length,expected);
  assert.equal(saved.fallbackError,["budget_denied","fallback_failure"].includes(mode)?"fallback_unavailable":null);
});
