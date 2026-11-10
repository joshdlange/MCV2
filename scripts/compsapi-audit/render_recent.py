import json,html
from pathlib import Path
p=Path("generated-artifacts/compsapi-audit")
x=json.loads((p/"recent.json").read_text())
report=Path("reports/compsapi-recent-validation-2026-11-10.md").read_text()
columns=["ID","Name","Set / subset / number","30d count","90d count / median","180d count / median","365d count / median","Tier","Confidence","Model B","Active estimate / delta / cache date"]
rows=[]
for r in x["cards"]:
 def v(n):
  z=r["windows"][str(n)]
  return f'{z["count"]} / {z["median"]}'
 rows.append([r["id"],r["name"],f'{r["card"]["parent"]} / {r["card"]["subset"]} / {r["card"]["cardNumber"]}',r["windows"]["30"]["count"],v(90),v(180),v(365),r["tier"],r["confidence"],r["modelB"],f'{r["legacy"].get("avg_price")} / {r["activeDifference"]} / {r["legacy"].get("last_fetched")}'])
table="<table><tr>"+"".join("<th>"+html.escape(c)+"</th>" for c in columns)+"</tr>"+"".join("<tr>"+"".join("<td>"+html.escape(str(c))+"</td>" for c in row)+"</tr>" for row in rows)+"</table>"
(p/"recent-report.html").write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Recent-sales final validation</title><style>body{font:15px/1.6 system-ui;margin:32px;color:#172033}pre{white-space:pre-wrap;font:inherit;max-width:1100px}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #ccd;padding:8px;text-align:left}.scroll{overflow:auto}</style><h1>Recent-sales final validation</h1><pre>'+html.escape(report)+'</pre><h2>Exact 25-card cohort and confidence assignments</h2><div class="scroll">'+table+'</div><h2>Complete per-card window statistics</h2>'+''.join('<details><summary>'+html.escape(str(r["id"])+" "+r["name"])+'</summary><pre>'+html.escape(json.dumps(r,indent=2))+'</pre></details>' for r in x["cards"])+'</html>')
