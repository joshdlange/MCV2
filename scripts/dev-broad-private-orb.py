"""Private I/O adapter around the immutable, previously frozen ORB implementation."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path
os.umask(0o077)
root = Path(sys.argv[1])
assert re.fullmatch(r"/tmp/mcv-private-validation-[A-Za-z0-9]+", str(root))
plan = json.loads((root / "preinference-selection.json").read_text())
path = Path("scripts/dev-orb-isolation.py")
assert hashlib.sha256(path.read_bytes()).hexdigest() == plan["sourceHashes"][str(path)]
source = path.read_text().replace('ROOT = Path(".local/detail-orb")', f"ROOT = Path({str(root / 'orb')!r})")
start = source.index("safe_extent_indices = {")
end = source.index("\nreference_review =", start)
source = source[:start] + """boundary_review = json.loads(Path(".local/detail-orb/reference-boundary-review.json").read_text())
safe_digests = {r["digest"] for r in boundary_review if r["boundaryVerified"]}
safe_extent_indices = {r["reviewIndex"] for r in job["refs"] if r["digest"] in safe_digests}
""" + source[end:]
exec(compile(source, str(path), "exec"))