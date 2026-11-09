"""Offline audit of frozen production diagnostics. No network or database writes."""
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from html import escape

root = Path("generated-artifacts/soldgraph-audit")
data = json.loads((root / "baseline.json").read_text())
queries = json.loads((root / "generated-queries.json").read_text())
pages = sum((json.loads((root / f"manual-pages-{i}.json").read_text()) for i in [1, 2, 3]), [])
pages = {p["id"]: p for p in pages if "," not in p["id"] and "ebay.com/itm/" in p.get("markdown", "")}
false_ids = {
    "237092524719", "307234961712", "377541052767", "227539673909",
    "227458145859", "800623390299", "237010481745", "227454256305",
    "407200741321", "227504587533", "327319543236", "136426877426",
    "318626439159", "306880098982", "377373747835", "116469984168",
    "318699172928", "236984636068", "366557661853",
}
primary = {
    528934: "ONLY_GRADED_RESULTS", 183670: "INSUFFICIENT_SOLD_DATA",
    17528: "INSUFFICIENT_SOLD_DATA", 17531: "INSUFFICIENT_SOLD_DATA",
    17535: "ONLY_BEST_OFFER_RESULTS", 18856: "CATALOG_METADATA_PROBLEM",
    46928: "SET_NAME_MISMATCH", 65956: "SERIAL_NUMBER_MISMATCH",
    332384: "SERIAL_NUMBER_MISMATCH", 534821: "SERIAL_NUMBER_MISMATCH",
    536012: "CARD_NUMBER_FORMAT_MISMATCH", 536609: "SERIAL_NUMBER_MISMATCH",
    536616: "CARD_NUMBER_FORMAT_MISMATCH", 537023: "SERIAL_NUMBER_MISMATCH",
    543517: "SET_NAME_MISMATCH", 559317: "SERIAL_NUMBER_MISMATCH",
    559642: "ONLY_WRONG_PARALLEL_RESULTS", 563287: "SUBSET_NAME_MISMATCH",
    548627: "CATALOG_METADATA_PROBLEM", 548660: "CATALOG_METADATA_PROBLEM",
    548661: "CATALOG_METADATA_PROBLEM", 548680: "CATALOG_METADATA_PROBLEM",
}
counts = Counter()
causes = Counter()
validation = []
table = []
for r in data:
    c, result = r["card"], r["result"]
    n = result["usableCount"]
    counts["three_plus" if n >= 3 else "limited" if n else "zero"] += 1
    counts["upstream"] += result["upstreamCount"]
    counts["accepted"] += result["acceptedCount"]
    counts["rejected"] += result["rejectedCount"]
    legacy = float((r.get("legacy") or {}).get("avg_price") or 0) > 0
    r["soldState"] = "SOLDGRAPH_SOLD_COMPS" if n >= 3 else "SOLDGRAPH_LIMITED_DATA" if n else "SOLDGRAPH_NO_COMPS"
    r["postRefreshState"] = r["soldState"] if n or not legacy else "LEGACY_ACTIVE_ESTIMATE"
    r["fallbackQueriesAttempted"] = False
    r["generatedQueriesCurrentMetadata"] = queries[str(c["id"])]
    r["serialMetadata"] = re.findall(r"/\s*(\d+)", c["subset"] + " " + (c["variation"] or "")) or ["unspecified"]
    r["primaryFailureCause"] = None if n else ("NO_UPSTREAM_RESULTS" if not result["upstreamCount"] else primary.get(c["id"], "OTHER"))
    if not n:
        causes[r["primaryFailureCause"]] += 1
    if r["postRefreshState"] == "LEGACY_ACTIVE_ESTIMATE":
        counts["fallback_with_current_legacy"] += 1
    page = pages.get(str(c["id"]))
    external_ids = set(re.findall(r"ebay\.com/itm/(\d+)", page["markdown"])) if page else set()
    false_here = 0
    for d in result["decisions"]:
        if d["rejection"]:
            if d["id"] in false_ids and d["id"] in external_ids:
                d["auditJudgment"] = "FALSE REJECTION"
                d["auditEvidence"] = page["url"]
                counts["false_rejections_confirmed"] += 1
                false_here += 1
            elif d["rejection"] in ["graded", "lot_or_multi_card", "duplicate_listing"] or re.search(r"\b(psa|bgs|cgc|sgc|you pick|u pick|pick a|choose|complete set)\b", d["title"] or "", re.I):
                d["auditJudgment"] = "CORRECT REJECTION"
                counts["correct_rejections_clear"] += 1
            else:
                d["auditJudgment"] = "UNCERTAIN"
                counts["uncertain_rejections"] += 1
        else:
            d["auditJudgment"] = "ACCEPTED; not independently certified"
        if c["id"] == 55500 and d["usable"] and re.search(r"#46-V\b", d["title"] or "", re.I):
            d["auditJudgment"] = "SUSPECTED FALSE ACCEPTANCE: variant-cover number"
            counts["suspected_false_acceptances"] += 1
    if false_here:
        counts["cards_with_confirmed_false_rejection"] += 1
    if page:
        same = external_ids & {d["id"] for d in result["decisions"]}
        validation.append({"cardId": c["id"], "url": page["url"], "matchingListingIds": sorted(same),
            "confirmedFalseRejections": false_here,
            "interpretation": "Same listing IDs establish returned-vs-rejected distinction; unmatched external sales do NOT alone establish provider coverage gaps. Dates/windows and query constraints differ."})
    table.append([c["id"], c["name"], c["year"], c["parent"], c["subset"], c["cardNumber"], c["variation"],
                  ", ".join(r["serialMetadata"]), r["query"], False, result["upstreamCount"], n,
                  result["median"], result["low"], result["high"], r["postRefreshState"], r["primaryFailureCause"]])
assert len(data) == 50 and len(pages) == 15
assert counts["false_rejections_confirmed"] == len(false_ids)
counts["cards"] = len(data)
counts["manual_source_cards"] = len(validation)
counts["provider_calls"] = 0
counts["families"] = len({r["card"]["parent"] for r in data})
(root / "audited-results.json").write_text(json.dumps(data, indent=2))
(root / "manual-validation.json").write_text(json.dumps(validation, indent=2))
(root / "metrics.json").write_text(json.dumps({"counts": counts, "zeroCompCauses": causes}, indent=2))
with (root / "cards.csv").open("w") as f:
    writer = csv.writer(f)
    writer.writerow(["id","name","year","parent","subset","number","variation","serialMetadata","exactQuery","fallbackQueriesAttempted","upstream","usable","median","low","high","postRefreshState","primaryFailureCause"])
    writer.writerows(table)
(root / "frozen-code-sha256.json").write_text(json.dumps({
    str(p): hashlib.sha256(p.read_bytes()).hexdigest()
    for p in [Path("server/pricing/soldgraph-matching.ts"), Path("server/pricing/soldgraph-cache.ts"), root / "baseline.json"]
}, indent=2))
print(json.dumps({"counts": counts, "zeroCompCauses": causes}, indent=2))

# Self-contained report includes the frozen per-listing decisions, not only totals.
report = Path("reports/soldgraph-failure-audit-2026-11-09.md").read_text()
sections = []
for r in data:
    c = r["card"]
    rows = "".join("<tr>" + "".join(f"<td>{escape(str(v))}</td>" for v in [
        d["id"], d["title"], d["bestOfferAccepted"], d["rejection"],
        d["exclusion"], d["usable"], d["auditJudgment"], d["displayedPrice"],
    ]) + "</tr>" for d in r["result"]["decisions"])
    metadata = {k:v for k,v in r.items() if k != "result"}
    metadata["metrics"] = {k:v for k,v in r["result"].items() if k != "decisions"}
    sections.append(f"<details><summary>{c['id']} — {escape(c['name'])} — {r['result']['usableCount']} usable comps</summary>"
        f"<pre>{escape(json.dumps(metadata,indent=2))}</pre><div class='table'><table><thead><tr>"
        "<th>Listing ID</th><th>Title</th><th>Best Offer</th><th>Rejection</th><th>Price exclusion</th>"
        f"<th>Usable</th><th>Audit judgment</th><th>Displayed price</th></tr></thead><tbody>{rows}</tbody></table></div></details>")
source_html = "".join(f"<li>Card {v['cardId']}: <a href='{escape(v['url'],quote=True)}'>independent sale history</a>"
    f" — {len(v['matchingListingIds'])} matching listing IDs; {v['confirmedFalseRejections']} confirmed false rejections.</li>" for v in validation)
html = f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>SoldGraph failure audit — 50 production cards</title>
<style>body{{font:16px/1.6 system-ui;margin:32px auto;padding:0 24px;max-width:1200px;color:#172033;background:#fafbfd}}
h1,h2{{line-height:1.2}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 system-ui}}details{{background:white;border:1px solid #ccd3dc;margin:12px 0;padding:16px;border-radius:8px}}
summary{{cursor:pointer;font-weight:700}}.table{{overflow:auto}}table{{border-collapse:collapse;font-size:13px}}td,th{{padding:8px;border:1px solid #ccd3dc;text-align:left;vertical-align:top}}a{{color:#1649a1}}</style>
<h1>SoldGraph failure audit</h1><p>50 real production cards · 0 new SoldGraph calls · No application changes</p>
<pre>{escape(report)}</pre><h2>15 independent comparisons</h2><ul>{source_html}</ul>
<h2>Full card and upstream-result audit</h2><p>Expand each card. UNCERTAIN means not certified, not a correct rejection.</p>{''.join(sections)}</html>"""
(root / "report.html").write_text(html)
assert html.count("<details>") == 50
assert len(validation) == 15
