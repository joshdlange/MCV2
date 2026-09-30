"""Run immutable prior ORB implementation with only local I/O and whitelist mapping adapted."""
import hashlib
import json
from pathlib import Path

root = Path(".local/broad-validation")
plan = json.loads((root / "frozen-plan.json").read_text())
source_path = Path("scripts/dev-orb-isolation.py")
source = source_path.read_text()
assert hashlib.sha256(source_path.read_bytes()).hexdigest() == plan["sourceHashes"][str(source_path)]
source = source.replace('ROOT = Path(".local/detail-orb")', 'ROOT = Path(".local/broad-validation/orb")')
start = source.index("safe_extent_indices = {")
end = source.index("\nreference_review =", start)
replacement = """boundary_review = json.loads(Path(".local/detail-orb/reference-boundary-review.json").read_text())
safe_digests = {r["digest"] for r in boundary_review if r["boundaryVerified"]}
safe_extent_indices = {r["reviewIndex"] for r in job["refs"] if r["digest"] in safe_digests}
"""
source = source[:start] + replacement + source[end:]
exec(compile(source, str(source_path), "exec"))