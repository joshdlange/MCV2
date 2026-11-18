"""Render read-only catalog query results into an owner review workbook."""
import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

root = Path("generated-artifacts/empty-sets-review")
def read(environment):
    result = json.loads((root / f"{environment}-result.json").read_text())
    assert result["exitCode"] == 0
    return json.loads(list(csv.reader(io.StringIO(result["output"])))[1][0])

prod, dev = read("production"), read("development")
development = {r["slug"]: r for r in dev}
old = {r["slug"]: r["review"] for r in csv.DictReader(open("reports/empty-set-owner-review-2026-11-05.csv"))}
active = lambda r: r["is_active"] and not r["archived_at"]
empty = [r for r in prod if active(r) and r["all_cards"] == 0]
pending = [r for r in empty if development.get(r["slug"], {}).get("all_cards", 0) > 0]
todo = [r for r in empty if r not in pending]
hidden = [r for r in prod if not active(r) and r["all_cards"] == 0]
no_base = [r for r in prod if active(r) and r["all_cards"] > 0 and r["base_cards"] == 0]
no_visible = [r for r in prod if active(r) and r["all_cards"] > 0 and r["visible_cards"] == 0]
now = datetime.now(timezone.utc).isoformat(timespec="seconds")
wb = Workbook()
summary = wb.active
summary.title = "Read Me"
for row in [
    ["Fresh main-set review", "Read-only production and development catalog queries"],
    ["Generated UTC", now],
    ["Start here", "Empty - To Review"],
    ["Empty - To Review", len(todo)],
    ["Filled in Development", len(pending)],
    ["Total active empty in production", len(empty)],
    ["Hidden Empty", len(hidden)],
    ["Cards But No Base", len(no_base)],
    ["No Visible Cards", len(no_visible)],
    ["Definition: truly empty", "Zero actual card rows across ALL linked subsets, including archived cards. Cached totals are not used."],
    ["Definition: base", "Unarchived card in an active, unarchived subset; both card and subset insert flags must be false."],
    ["Base warning", "No base cards can reflect classification errors or insert-only releases, not a missing checklist."],
    ["Production vs development", "Sets already populated in development are separated to avoid requesting their checklists again."],
    ["Visibility", "Active means main-set active flag with no archive date. No Visible Cards flags child visibility separately."],
    ["Old codes", "Original review codes preserved where available; use slug for entries without an old code. IDs can differ by environment."],
    ["Your decisions", "Fill in Decision, Checklist / source, and Review notes. Candidate removal is NOT deletion authorization."],
    ["Removal safety", "No data changed. Before removal, recheck cards, collector references, release links, history and startup dependencies."],
    ["Scope", "This is a main-set report, not a list of every empty subset inside populated main sets."],
    ["Snapshot", "Queries run sequentially, not as a cross-environment transaction. Counts are a point-in-time review."],
]:
    summary.append(row)
summary.column_dimensions["A"].width = 36
summary.column_dimensions["B"].width = 115
for row in summary:
    row[0].font = Font(bold=True)
    row[1].alignment = Alignment(wrap_text=True, vertical="top")
    summary.row_dimensions[row[0].row].height = 34

headers = ["Old code", "Main set", "Production status", "Production cards (all)",
           "Production visible cards", "Production base cards", "Subsets",
           "Development cards (all)", "Development status", "Decision",
           "Checklist / source", "Review notes", "Catalog notes", "Slug", "Production ID"]

def values(r):
    d = development.get(r["slug"])
    return [old.get(r["slug"], ""), r["name"].strip(),
            "Active" if active(r) else "Hidden / archived", r["all_cards"],
            r["visible_cards"], r["base_cards"], r["subsets"],
            d["all_cards"] if d else None,
            ("Active" if active(d) else "Hidden / archived") if d else "Not present",
            "", "", "", r["notes"] or "", r["slug"], r["id"]]

def sheet(title, rows):
    ws = wb.create_sheet(title)
    ws.append(headers)
    for r in rows:
        ws.append(values(r))
    ws.freeze_panes = "C2"
    ws.sheet_view.zoomScale = 85
    widths = [12, 65, 20, 20, 20, 20, 12, 22, 22, 24, 45, 55, 60, 65, 16]
    for i, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = width
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="243746")
        cell.alignment = Alignment(wrap_text=True)
    ws.row_dimensions[1].height = 42
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            # Source text is never interpreted as an Excel formula.
            if isinstance(cell.value, str):
                cell.data_type = "s"
            cell.alignment = Alignment(vertical="top", wrap_text=True)
        for cell in row[9:12]:
            cell.fill = PatternFill("solid", fgColor="FFF2CC")
    if rows:
        tab = Table(displayName=f"Review{len(wb.worksheets)}", ref=f"A1:O{len(rows)+1}")
        tab.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
        ws.add_table(tab)
        dv = DataValidation(type="list", formula1='"Populate,Keep,Duplicate candidate,Remove candidate,Needs research,Already completed"', allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(f"J2:J{len(rows)+1}")
    return ws

sheet("Empty - To Review", todo)
sheet("Filled in Development", pending)
sheet("Hidden Empty", hidden)
sheet("Cards But No Base", no_base)
sheet("No Visible Cards", no_visible)
sheet("All Main Sets", prod)
path = root / "main-sets-review-2026-11-18.xlsx"
wb.save(path)
with (root / "empty-main-sets-2026-11-18.csv").open("w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(headers)
    writer.writerows(values(r) for r in todo)
check = load_workbook(path)
assert check["Empty - To Review"].max_row - 1 == len(todo)
assert len({r["slug"] for r in empty}) == len(empty)
assert all(r["all_cards"] == 0 for r in todo + pending + hidden)
print(json.dumps({"production_main_sets": len(prod), "to_review": len(todo),
                  "filled_in_development": len(pending), "active_empty_production": len(empty),
                  "hidden_empty": len(hidden), "cards_but_no_base": len(no_base),
                  "no_visible_cards": len(no_visible), "pending_names": [r["name"] for r in pending]}, indent=2))
