import {test} from "node:test";
import assert from "node:assert/strict";
import {analyze,numberMatches,reason} from "./evaluate";
const c={id:1,name:"Blade",cardNumber:"39",year:2024,parent:"2024 Topps Chrome Marvel",subset:"Blue Wave Refractor",variation:null,siblings:["Base","Green Wave"]};
const row={item_id:"1",title:"2024 Topps Chrome Marvel Blade #39 Blue Wave /150",price:12,best_offer:true,last_sold:"2026-11-01T00:00:00Z",shipping_cost:50};
test("number identity",()=>{
  for(const [a,b] of [["FF-23","#FF23"],["01","1"],["PB5","PB-05"],["MI-4","MI4"],["AU-11","AU11"]])assert.ok(numberMatches(a,b));
  for(const [a,b] of [["46","46-V"],["5","PB5"],["11","AU-11"],["4","MI-4"],["46","46V"]])assert.ok(!numberMatches(a,b));
});
test("offers use item price, never shipping",()=>{
  const r=analyze(c,[row]);assert.equal(r.usableCount,1);assert.equal(r.bestOfferCount,1);assert.equal(r.median,12);
});
test("parallel, lots, grades and malformed values excluded",()=>{
  for(const title of [row.title.replace("/150","/99"),row.title.replace("Blue Wave","Green Wave"),
    row.title.replace("Blue Wave /150","Base"),row.title+" Canvas",row.title+" PSA 10",
    row.title+" sealed box",row.title+" lot",row.title+" 3 cards",row.title+" GEM MINT 10",row.title+" MINT+ 9.5"]){
      assert.ok(reason(c,{...row,title}),title);
    }
  assert.equal(analyze(c,[{...row,card:{graded:true}}]).usableCount,0);
  assert.equal(analyze(c,[{...row,price:0}]).usableCount,0);
  assert.equal(analyze(c,[row,row]).usableCount,1);
});
test("character colors, explicit suffix numbers and base variants stay distinct",()=>{
  const goblin={...c,year:2026,parent:"2026 Topps Chrome Marvel Comics",name:"Green Goblin",cardNumber:"45",subset:"Purple RayWave Refractor",siblings:["Green RayWave Refractor"]};
  assert.equal(reason(goblin,{title:"2026 Topps Chrome Marvel Green Goblin #45 Purple RayWave /75"}),null);
  assert.equal(reason(goblin,{title:"2026 Topps Chrome Marvel Green Goblin #45 Purple RayWave /99"}),"wrong_serial");
  const iron={...c,year:2026,parent:"2026 Topps Marvel Neon",name:"Iron Man",cardNumber:"1",subset:"BASE",siblings:[]};
  for(const title of ["2026 Topps Marvel Neon Iron Man #1 Diamante","2026 Topps Marvel Neon Iron Man #1 Rivals","2026 Topps Marvel Neon Captain America 1 Up Iron Man #1UP-8"])
    assert.ok(reason(iron,{title}),title);
});
