# Catalog visual retrieval deployment prerequisites

1. Confirm the deployed database connection before applying schema changes.
   Runtime currently reads `DATABASE_URL`; this does not prove it is the same
   database as `NEON_DATABASE_URL` or that Replit Publish manages its schema.
   This project's legacy duplicates block `db:push`; its external-database
   convention uses parent-owned, advisory-locked additive startup transactions.
   The application initializer must finish the isolated new table/index
   transaction before starting the worker. Optional manual migration
   `scripts/sql/catalog-visual-references.sql` mirrors that transaction.
   It is additive and does not change catalog images. No DDL runs during build.
   If the target is instead verified Replit-managed, use its supported Publish
   schema diff, not the external-database startup convention.
2. Run `npm run build`. Its final step downloads the pinned DINOv2-small q8 model
   and configs into `dist/models`, then verifies CPU inference with remote model
   downloads and filesystem model cache disabled. A download or inference error
   fails the build. Deploy the entire `dist` artifact, including `dist/models`.
   Launch from the project root (`npm start`). Production cannot fetch a missing
   model remotely: a missing/broken artifact makes visual retrieval unavailable.
3. Enable the runtime index worker only after the schema is available. It builds
   from active catalog front references, not scans, 16 references per batch with
   a 30-second pause after each batch. Missing schema backs off; the worker does
   not create it or duplicate the parent-owned initialization.
   `CATALOG_VISUAL_INDEX_ENABLED=false` disables backfill.
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