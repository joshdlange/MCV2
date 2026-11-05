"""Build an owner review list from the read-only production audit exports."""
import csv
from pathlib import Path

root = Path("reports")
main = list(csv.DictReader((root / "catalog-main-sets-2026-11-05.csv").open()))
subsets = list(csv.DictReader((root / "catalog-empty-subsets-2026-11-05.csv").open()))
refs = {r["id"]: r for r in csv.DictReader((root / "catalog-hidden-references-2026-11-05.csv").open())}
by_id = {int(r["id"]): r for r in main}
# Explicit review mappings; these are not a deletion manifest.
matches = {
    2:201, 81:122, 5:169, 8:173, 16:190, 18:85, 19:503,
    21:479, 22:193, 23:200, 25:202, 26:206, 30:217, 31:506,
    32:219, 34:216, 37:221, 39:485, 40:484, 41:87, 58:351,
    43:486, 44:232, 46:249, 48:514, 50:272, 51:97, 52:101,
    53:307, 62:365, 65:376, 67:384, 68:385, 73:408, 75:413, 78:423,
}
out = []
counters = {}
for r in main:
    hidden = r["is_active"] == "f" or bool(r["archived_at"])
    empty = int(r["total_cards"]) == 0
    if not empty and not hidden:
        continue
    ident = int(r["id"])
    target = ""
    if not empty:
        group, prefix = "Hidden but contains cards - preserve and review", "H"
        note = "Not eligible for empty-set deletion. Check identity and all references before any merge."
    elif ident in matches:
        group, prefix = "Empty legacy duplicate candidate", "D"
        target = by_id[matches[ident]]["name"].strip()
        note = "Populated replacement exists; revalidate references and startup-seed dependencies before deleting."
    elif ident in {494,495,496,497,498,499,500,302,411}:
        group, prefix = "Hidden empty - appears outside Marvel scope", "S"
        note = "Not a duplicate claim. Confirm removal from catalog scope."
    elif hidden:
        group, prefix = "Hidden empty - identity decision needed", "R"
        note = {
            214: "1995 DC vs. Marvel exists, but this entry says 1996. Confirm year/identity before deleting.",
            47: "2008 Masterpieces Set 2 and Set 3 exist. Do not assume which this generic entry represents.",
            492: "SDCC subset names appear under 2025 Finest X-Men '97; verify placement rather than assuming releases are duplicates.",
            113: "No populated replacement identified. Confirm whether to populate or leave excluded.",
        }.get(ident, "No confirmed populated replacement identified.")
    else:
        group, prefix = "Empty active set - checklist or identity review", "P"
        note = "No obvious populated same-release main-set replacement identified. Supply checklist or confirm identity/scope."
        if ident in {399,400,405,406,428,429}:
            note = "Possible related edition/language counterpart also empty; confirm identity before merging or populating."
    counters[prefix] = counters.get(prefix, 0) + 1
    code = f"{prefix}{counters[prefix]:03}"
    children = [s for s in subsets if s["main_set_id"] == r["id"]]
    blockers = [s["name"] for s in children if any(s[k] == "t" for k in
                ["shared","migration_mapping","card_migration_history","migration_history"])]
    rr = refs.get(r["id"], {})
    out.append({
        "review": code, "category": group, "set": r["name"].strip(), "database_id": r["id"],
        "slug": r["slug"], "card_rows_including_archived": r["total_cards"],
        "unarchived_card_rows": r["live_cards"], "subsets": r["subsets"],
        "populated_replacement": target, "collection_entries": rr.get("collection_rows","0"),
        "wishlist_entries": rr.get("wishlist_rows","0"),
        "empty_subsets_with_reference_history": len(blockers),
        "recommendation": note, "owner_decision": "", "checklist_or_notes": "",
    })
path = root / "empty-set-owner-review-2026-11-05.csv"
with path.open("w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=out[0].keys())
    writer.writeheader()
    writer.writerows(out)
lines = [
    "# Empty and hidden catalog review — November 5, 2026", "",
    "Source: read-only production database snapshot. No records were deleted or populated.",
    "Counts use actual card rows, including archived cards, not cached checklist totals.",
    "Active/inactive flags are database states, not proof of what every catalog screen displays.", "",
    "## Summary", "",
    f"- {counters.get('P',0)} active main sets with no card rows: checklist/identity review.",
    f"- {counters.get('D',0)} empty hidden legacy duplicate candidates with populated replacements.",
    f"- {counters.get('S',0)} empty hidden entries that appear outside Marvel scope.",
    f"- {counters.get('R',0)} empty hidden entries needing an identity/scope decision.",
    f"- {counters.get('H',0)} hidden main sets still containing cards; not safe for empty-set deletion.",
    f"- {len(subsets)} empty subset records overall; these overlap the main-set lists and are not additional empty releases.",
    "", "## Review instructions", "",
    "Use the review code when replying. For each set: populate, duplicate of [name], keep hidden, or remove.",
    "For population, provide card number, card name, subset, and any parallel/checklist rules.",
    "Deletion candidates still require a transactional recheck, dependency checks against startup repairs, and preservation of history/share links.",
    "Collection/wishlist counts are reference rows, not distinct collectors or summed quantities. Other reference types must be checked before merging.",
    "",
]
for prefix, title in [
    ("D","Empty duplicate candidates"), ("R","Hidden empty entries needing your decision"),
    ("S","Apparently outside Marvel scope"), ("P","Empty sets awaiting checklists or identification"),
    ("H","Hidden sets with cards — do not delete outright"),
]:
    lines += [f"## {title}", ""]
    for r in out:
        if not r["review"].startswith(prefix):
            continue
        detail = f" → {r['populated_replacement']}" if r["populated_replacement"] else ""
        if prefix == "H":
            detail = f" — {r['card_rows_including_archived']} card rows; {r['collection_entries']} collection entries; {r['wishlist_entries']} wishlist entries."
        if prefix == "R":
            detail = f" — {r['recommendation']}"
        lines.append(f"- **{r['review']}** {r['set']}{detail}")
    lines.append("")
(root / "empty-set-owner-review-2026-11-05.md").write_text("\n".join(lines))
print(counters)
print("\n".join(f"{r['review']} {r['set']}" for r in out if r["review"].startswith("P"))[:2400])
