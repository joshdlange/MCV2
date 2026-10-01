# Catalog visual retrieval deployment prerequisites

Visual retrieval and artwork verification are **off by default**.
`SCAN_VISUAL_RETRIEVAL=on` (exactly `on`) adds DINO picture retrieval to
`POST /api/cards/scan`; `SCAN_ART_VERIFICATION=on` adds the sequential GPT
artwork comparison (up to 8 s). With both off, a scan is OCR then metadata
match only: no model load, no visual-index reads, no comparison call.

1. Schema. There is no startup DDL. The table is declared in `shared/schema.ts`
   and the migration is `scripts/sql/catalog-visual-references.sql` (additive,
   one table plus two indexes, no catalog changes, no pgvector). Confirm the
   deployed application's actual database target before applying it: runtime
   reads `DATABASE_URL`, which is not proven to equal `NEON_DATABASE_URL`, and
   legacy duplicates block `db:push`. For an externally managed Neon target, an
   authorized operator applies the SQL file. For a verified Replit-managed
   target, use the Publish schema diff. Apply it before turning on either flag.
2. Model. `npm run build` ends with `scripts/prepare-catalog-visual-model.ts`.
   It is skipped unless `SCAN_VISUAL_RETRIEVAL=on` or
   `CATALOG_VISUAL_INDEX_ENABLED=true` is set at build time. When it runs, it
   downloads the pinned DINOv2-small q8 model and configs into `dist/models`
   and verifies offline CPU inference. A download or inference failure logs a
   warning and does **not** fail the build. Production never fetches a model
   remotely, so a missing or broken artifact makes visual search report
   "unavailable". Changing either flag requires a new build and Publish.
3. Enable the runtime index worker only after the schema is available. It builds
   from active catalog front references, not scans, 16 references per batch with
   a 30-second pause after each batch. Missing schema backs off; the worker does
   not create it or duplicate the parent-owned initialization.
   Backfill is disabled by default while recognition is being validated.
   Only `CATALOG_VISUAL_INDEX_ENABLED=true` explicitly enables it; do not enable
   automatic or full bulk indexing until the real-photo evaluation is reviewed.
   Replicas share the database advisory lock but have independent model/cache RAM.
4. Model availability is not index completeness. A new deployment starts with
   whatever reference vectors exist in its own database; development vectors are
   not automatically copied. Inspect `getCatalogVisualStatus()` for eligible,
   indexed and failed/exhausted counts. Queries report partial coverage honestly.
   The cache holds at most 100,000 references; clipped coverage remains partial.
   Full backfill of an approximately 81,000-card catalog takes many hours.
5. The model uses 384-dimensional DINO CLS vectors and cosine similarity, not
   calibrated identification probabilities. The transformed-reference CLI sanity
   check establishes reference retrieval only, not accuracy on collector photos.
   Human confirmation and ambiguous/no-match handling remain necessary.

Development may download the same pinned model on demand. To exercise only the
build artifact in development, set `CATALOG_VISUAL_OFFLINE=true`. The bounded
development CLI is `npm run catalog:visual:index -- --batch-size=16 --sanity`.

## Development bulk CLI (single-image inference)

`catalog:visual:bulk` requires `NODE_ENV=development`, a local development
database, and no deployment flag. There is no production override. It takes one
eligible/current-model snapshot, holds the normal worker's session advisory lock
for the run, downloads at concurrency four with one bounded batch ahead, and
emits JSON progress and a final summary. `--batch-size=8|16` controls download
windows only: every new vector uses **the exact single-image query embedding
function**. Tensor-batched q8 inference was removed because dynamic quantization
changed vectors. The sequential convenience wrapper retains strict `1e-5`
parity tests; it does not run tensor batches. Waiting scans take priority between
individual inference calls. CPU inference remains capped at two threads.

```sh
NODE_ENV=development CATALOG_VISUAL_OFFLINE=true npm run catalog:visual:bulk -- --status
NODE_ENV=development CATALOG_VISUAL_OFFLINE=true npm run catalog:visual:bulk -- --dry-run --limit=128
NODE_ENV=development CATALOG_VISUAL_OFFLINE=true npm run catalog:visual:bulk -- --write --limit=128
```

The corrected development pilot indexed 128 references: 128 successful downloads,
78 successful individual inferences, 50 digest reuses, zero failures. Work time
was 13.252 seconds; complete CLI wall time was 14.359 seconds. This bounded
sample is not a full-catalog throughput guarantee. No full import was launched.

The narrowly scoped repair command is `--write --repair-ready` (no `--limit`).
It snapshots **all** ready references, including currently ineligible ones,
re-downloads and individually embeds every reference without any digest reuse,
and atomically replaces derived vectors only after successful inference.
Failed repairs become failed references, not searchable/reusable ready vectors.
It rejects ready vectors from a different model version for separate review.
The completed development repair replaced all 734 ready vectors individually,
with zero failures/reuses and zero pending unsafe ready vectors, in 77.507
seconds. No catalog images were modified. Normal retries retain existing
five-minute exponential backoff and the five-attempt ceiling.

Verification:
`NODE_ENV=development CATALOG_VISUAL_REAL_TEST=true npm run test:catalog-visual`.
All eight tests passed, including strict parity on 16 real references and eight
synthetic inputs (observed maximum component error zero). Repair/pilot/test logs
are under `/tmp/catalog-visual-bulk/` (`repair-ready.jsonl`,
`corrected-pilot-128.jsonl`, `repaired-parity-tests.log`).
## Keeping development data out of the deployment

`.local/` (experiment data, SAM weights, collector photos) and `.pythonlibs/`
(torch, OpenCV, segment-anything) are gitignored and untracked. Whether
Replit's deployment snapshot honours `.gitignore` is not verified. The
experiment-only `pyproject.toml`/`uv.lock` (torch, torchvision, OpenCV,
segment-anything) were removed from `main`; restore them from git history
(`git show 8aee322:pyproject.toml`) only for further development experiments.

Every production boot logs one line:

- `[deploy-check] No development-only paths in deployment.` means none of
  `.local`, `.pythonlibs`, `pyproject.toml`, `uv.lock` are present.
- `[deploy-check] Development-only paths present in deployment: ...` lists the
  ones that shipped.

If any are present, or the deployment build log shows Python packages being
installed, choose one before the next Publish:

1. Move the experiment data out of the project directory, e.g.
   `mkdir -p ~/scan-experiments && mv .local/<dir> ~/scan-experiments/`
   (the deployment snapshot covers the project directory only).
2. If Python packages are still installed during the deployment build, drop
   `python-3.11` from `.replit` `modules` (present since July, before the scan
   experiments; no production code uses Python).
