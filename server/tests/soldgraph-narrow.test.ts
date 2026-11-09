import {test} from "node:test";
import assert from "node:assert/strict";
import {matchesCardNumber, rejectionReason, buildSoldQueries} from "../pricing/soldgraph-matching";
test("token-aware card numbers retain prefixes and suffixes",()=>{
  for(const [a,b] of [["FF-23","FF23"],["FF-23","#FF-23"],["01","1"],["PB5","PB-05"],["AU-11","AU11"],["MI-4","MI04"],["128","#128 - Dr. Doom"]])
    assert.equal(matchesCardNumber(a,b),true,`${a}/${b}`);
  for(const [a,b] of [["46","46-V"],["46","46V"],["5","PB5"],["11","AU-11"],["4","MI-4"],["PB5","5"],["AU-11","11"],["MI-4","4"],["46","146"]])
    assert.equal(matchesCardNumber(a,b),false,`${a}/${b}`);
});
test("new recall never admits obvious multi-card and canvas variants",()=>{
  const c={...card,parent:"1990 Impel Marvel Universe",year:1990,subset:"Base",name:"Wolverine",cardNumber:"23"};
  assert.equal(rejectionReason(c,{title:"1990 Marvel Universe Wolverine SET #10, 23, 37"} as any),"lot_or_multi_card");
  assert.equal(rejectionReason(c,{title:"1990 Marvel Universe Wolverine #23 Canvas"} as any),"contradictory_parallel");
});
const card={id:1,name:"Blade",cardNumber:"39",year:2024,parent:"2024 Topps Chrome Marvel",subset:"Blue Wave Refractor",variation:null,siblings:[]};
test("known serial is scoped to exact family and subset",()=>{
  const row=(title:string)=>({title} as any);
  assert.equal(rejectionReason(card,row("2024 Topps Chrome Marvel Blade 39 Blue Wave /150")),null);
  assert.equal(rejectionReason(card,row("2024 Topps Chrome Marvel Blade 39 Blue Wave /99")),"wrong_serial_parallel");
  assert.equal(rejectionReason({...card,subset:"Purple"},row("2024 Topps Chrome Marvel Blade 39 Purple /99")),"uncertain_serial_parallel");
});
test("documented seasons normalize without global year relaxation",()=>{
  const c={...card,year:2023,parent:"2023-24 Upper Deck Marvel Annual",subset:"Base"};
  for(const year of ["2023","2023-24","2023–2024","2023/24"])
    assert.equal(rejectionReason(c,{title:`${year} Upper Deck Marvel Annual Blade 39`} as any),null);
  assert.equal(rejectionReason(c,{title:"2025 Upper Deck Marvel Annual Blade 39"} as any),"wrong_year");
  assert.equal(rejectionReason(c,{title:"2023/25 Upper Deck Marvel Annual Blade 39"} as any),"wrong_year");
  assert.ok(!buildSoldQueries(c)[0].includes("-24"));
});
