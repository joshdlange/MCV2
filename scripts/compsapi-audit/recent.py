"""Offline recent-value evaluation. No network, credentials or database access."""
import json,csv,statistics,datetime,math
from pathlib import Path
root=Path("generated-artifacts/compsapi-audit")
now=datetime.datetime(2026,11,10,15,40,0,tzinfo=datetime.timezone.utc)
ids=[15585,16813,17528,17531,17538,19478,357867,357868,18139,75365,26956,46928,61659,55500,58972,65954,320525,534593,534821,536609,536616,558282,559317,563294,554432]
data=json.loads((root/"comparison.json").read_text())
legacy={r["card"]["id"]:r["legacy"] for r in json.loads(Path("generated-artifacts/soldgraph-audit/baseline.json").read_text())}
def age(d):
 dt=datetime.datetime.fromisoformat(d.replace("Z","+00:00"))
 if dt.tzinfo is None:dt=dt.replace(tzinfo=datetime.timezone.utc)
 return (now-dt).total_seconds()/86400
def stats(rows):
 p=[r["price"] for r in rows];ds=sorted(r["last_sold"] for r in rows)
 return dict(count=len(p),median=statistics.median(p) if p else None,low=min(p) if p else None,high=max(p) if p else None,newest=ds[-1] if ds else None,oldest=ds[0] if ds else None,bestOffers=sum(r.get("best_offer")==True for r in rows))
def weighted(rows):
 groups=[[r for r in rows if lo<age(r["last_sold"])<=hi] for lo,hi in [(-1,90),(90,180),(180,365)]]
 values=[(r["price"],weight/len(g)) for g,weight in zip(groups,[.7,.2,.1]) if g for r in g]
 if not values:return None
 half=sum(w for _,w in values)/2;acc=0
 for p,w in sorted(values):
  acc+=w
  if acc>=half:return p
out=[]
for id in ids:
 r=next(r for r in data["cards"] if r["card"]["id"]==id)
 rows=[d for d in r["compsapi"]["decisions"] if d["usable"] and age(d["last_sold"])>=0]
 windows={str(n):stats([d for d in rows if age(d["last_sold"])<=n]) for n in [30,90,180,365]}
 a,b,c=windows["90"],windows["180"],windows["365"]
 tier=1 if a["count"]>=3 else 3 if b["count"]>=3 else 2 if a["count"] else 4 if c["count"] else 5
 selected=a if a["count"]>=3 else b if b["count"]>=3 else a if a["count"] else None
 current=selected["median"] if selected else None
 p=[d["price"] for d in rows if age(d["last_sold"])<=90 and not d.get("best_offer")]
 without=statistics.median(p) if p else None
 spread=selected["high"]/selected["low"] if selected else None
 conf="HIGH" if a["count"]>=5 and min(age(d["last_sold"]) for d in rows)<=30 and spread<=4 else "MEDIUM" if selected and selected["count"]>=3 and spread<=8 else "LOW" if selected or c["count"] else "UNAVAILABLE"
 old=legacy[id] or {};active=float(old.get("avg_price") or 0)
 delta=abs(current-active)/active if current and active>0 else None
 sg=r["soldgraph"]; sgstrong=sg["usable"]>=3;cpstrong=a["count"]>=3
 outcome="COMPSAPI CLEARLY BETTER" if cpstrong and not sgstrong else "SOLDGRAPH CLEARLY BETTER" if sgstrong and not cpstrong else "SIMILAR" if cpstrong and sgstrong else "NEITHER RELIABLE"
 newest=min((age(d["last_sold"]) for d in rows),default=None)
 flags=[{"id":d["item_id"],"title":d["title"],"price":d["price"],"format":d.get("format"),"date":d["last_sold"]} for d in rows if age(d["last_sold"])<=365 and c["median"] and (d["price"]>c["median"]*5 or d["price"]<c["median"]/5)]
 out.append(dict(id=id,name=r["card"]["name"],card=r["card"],windows=windows,tier=tier,confidence=conf,modelA=a["median"],modelB=weighted(rows),current=current,spread=spread,withoutOffers=without,offerChange=abs(a["median"]-without)/without if without and a["median"] else None,offerRemovedAll=bool(a["count"] and not p),newestAge=newest,legacy=old,activeDifference=delta,soldgraph=sg,outcome=outcome,outliers=flags))
summary={
 "cards":25,"calls":0,"threePlus":{n:sum(r["windows"][n]["count"]>=3 for r in out) for n in ["30","90","180","365"]},
 "any":{n:sum(r["windows"][n]["count"]>0 for r in out) for n in ["90","180","365"]},
 "medianAge":statistics.median(r["newestAge"] for r in out if r["newestAge"] is not None),
 "confidence":{c:sum(r["confidence"]==c for r in out) for c in ["HIGH","MEDIUM","LOW","UNAVAILABLE"]},
 "tiers":{str(t):sum(r["tier"]==t for r in out) for t in range(1,6)},
 "bestOffers":{n:sum(r["windows"][n]["bestOffers"] for r in out) for n in ["30","90","180","365"]},
 "offerMaterial":[r["id"] for r in out if (r["offerChange"]or 0)>.1],
 "offerChanges":[r["id"] for r in out if (r["offerChange"]or 0)>0],
 "offerOnly":[r["id"] for r in out if r["offerRemovedAll"]],
 "wins":{s:sum(r["outcome"]==s for r in out) for s in ["COMPSAPI CLEARLY BETTER","SOLDGRAPH CLEARLY BETTER","SIMILAR","NEITHER RELIABLE"]},
 "activeFlags":{str(t):[r["id"] for r in out if (r["activeDifference"]or 0)>t] for t in [.25,.5,1]},
 "staleness":{label:sum(r["newestAge"] is not None and lo<r["newestAge"]<=hi for r in out) for label,lo,hi in [("0–30",-1,30),("31–90",30,90),("91–180",90,180),("181–365",180,365),("365+",365,math.inf)]},
 "noAcceptedSale":sum(r["newestAge"] is None for r in out)
}
(root/"recent.json").write_text(json.dumps(dict(asOf=now.isoformat(),summary=summary,cards=out),indent=2))
fields=["id","name","parent","subset","number","tier","confidence","daysSinceSale","modelA","modelB","current","active","activeDelta","sgCount","sgMedian","outcome"]+[f"{n}_{k}" for n in [30,90,180,365] for k in ["count","median","low","high","newest","oldest","bestOffers"]]
with (root/"recent.csv").open("w") as f:
 w=csv.writer(f);w.writerow(fields)
 for r in out:
  w.writerow([r["id"],r["name"],r["card"]["parent"],r["card"]["subset"],r["card"]["cardNumber"],r["tier"],r["confidence"],r["newestAge"],r["modelA"],r["modelB"],r["current"],r["legacy"].get("avg_price"),r["activeDifference"],r["soldgraph"]["usable"],r["soldgraph"]["median"],r["outcome"]]+[r["windows"][str(n)][k] for n in [30,90,180,365] for k in ["count","median","low","high","newest","oldest","bestOffers"]])
assert len(set(ids))==25 and all(r["windows"]["90"]["count"]<=r["windows"]["180"]["count"]<=r["windows"]["365"]["count"] for r in out)
print(json.dumps(summary,indent=2))
