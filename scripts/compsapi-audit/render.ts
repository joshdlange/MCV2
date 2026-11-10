import fs from "node:fs";
const dir="generated-artifacts/compsapi-audit";
const {metrics,cards}=JSON.parse(fs.readFileSync(`${dir}/comparison.json`,"utf8"));
const review=JSON.parse(fs.readFileSync("scripts/compsapi-audit/review-notes.json","utf8"));
const esc=(v:any)=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const reviewed=cards.filter((r:any)=>review.reviewedAcceptedTitlesForCards.includes(r.card.id)).flatMap((r:any)=>r.compsapi.decisions.filter((d:any)=>d.usable).map((d:any)=>({
  cardId:r.card.id,itemId:d.item_id,title:d.title,classification:"CORRECT MATCH",
  limitation:"Manually inspected title appears consistent; not physical-card authentication or verification of actual payment."
})));
fs.writeFileSync(`${dir}/manual-review.json`,JSON.stringify({review,acceptedTitleReviews:reviewed},null,2));
const sections=cards.map((r:any)=>`<details><summary>${r.card.id} — ${esc(r.card.name)} — ${esc(r.outcome)}</summary>
<pre>${esc(JSON.stringify({...r,compsapi:{...r.compsapi,decisions:undefined}},null,2))}</pre>
<table><tr><th>Listing</th><th>Title</th><th>Item price</th><th>Offer</th><th>Decision</th></tr>
${r.compsapi.decisions.map((d:any)=>`<tr><td>${esc(d.item_id)}</td><td>${esc(d.title)}</td><td>${esc(d.price)}</td><td>${esc(d.best_offer)}</td><td>${esc(d.rejection||d.exclusion||"Usable")}</td></tr>`).join("")}</table></details>`).join("");
const narrative=fs.existsSync("reports/compsapi-comparison-2026-11-10.md")?fs.readFileSync("reports/compsapi-comparison-2026-11-10.md","utf8"):"Analysis in progress.";
fs.writeFileSync(`${dir}/report.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>CompsAPI versus SoldGraph — 50-card evaluation</title><style>body{max-width:1200px;margin:30px auto;padding:0 20px;font:15px/1.6 system-ui;color:#19232e}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left}details{margin:12px 0;padding:14px;border:1px solid #ccc}summary{cursor:pointer;font-weight:700}</style>
<h1>CompsAPI versus SoldGraph</h1><pre>${esc(narrative)}</pre><h2>Metrics</h2><pre>${esc(JSON.stringify(metrics,null,2))}</pre>
<h2>Manual title review</h2><pre>${esc(JSON.stringify(review,null,2))}</pre><h2>All 50 cards and listing decisions</h2>${sections}</html>`);
