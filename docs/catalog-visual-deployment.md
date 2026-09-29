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