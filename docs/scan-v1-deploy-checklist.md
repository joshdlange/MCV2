# Single-card Scan v1 — release checklist

**Not ready to publish yet. No publishing or production writes were performed.**
Allow **4–7 focused engineering days**, plus **1–2 days of collector testing**,
assuming no major catalog repair or hosting problem. This is not a same-day release.

- [ ] **Establish exactly what would ship.** Record the successful live deployment's
  commit/build ID; review **every** unreleased commit, uncommitted change, migration,
  startup job and dependency change—not just scanner files. Live hosting is Autoscale,
  but its Git commit was not exposed by the deployment service. That release boundary
  remains unverified.
- [ ] **Separate destructive catalog maintenance from the release.** Recommendation:
  **gate**, rather than remove or silently keep running,
  `fixSuperfractor2026JunkSets` behind an explicit, separately approved maintenance
  switch. It repoints collector references, deletes duplicate cards and pending images,
  then empty subsets. Rehearse on a fresh copy; verify collector, quantity, binder,
  XP and reference preservation; back up first. Review other repair seeds too.
  This is a recommendation: the seed has **not** been changed.
- [ ] **Package the exact index and model.** The current frozen baseline is
  `.local/phase-c0/index-prod/index.json` plus `current.f32` (~133 MiB).
  Build a versioned, checksum-checked release artifact outside scratch `.local`
  paths. `scripts/prepare-catalog-visual-model.ts` bundles the pinned model
  (~24 MiB under `dist/models`). Its preparation currently fails softly: require
  offline load/inference to pass before accepting a build. Ship matching model,
  manifest and vectors; never download the model during a customer's first scan.
- [ ] **Bring references up to date.** Compare the **current production catalog**
  with October 1 by ID, active status, URL and content digest. Reuse unchanged vectors,
  embed new/changed images, reconcile merges and exclude archived/deleted cards.
  Persist approved overrides in database/object storage, not instance files;
  refresh every running instance.
- [ ] **Replace dev-specific behavior deliberately.** Introduce a production feature
  switch and migration instead of enabling a strict local-DB dev gate. Replace the
  in-memory Undo capability store with durable, user-scoped, expiring records.
  Make image/index/approval/audit commits atomic for every supported writer,
  including bulk/import paths; add retries and visible failures. Preserve real auth,
  entitlement limits, privacy, photo consent and admin-only auto-approval. Keep
  diagnostics photo-free; never ship fixtures or auth substitutes.
  The legacy scanner still uploads photos: ship the photo-free path without a
  silent fallback to that legacy behavior.
- [ ] **Measure hosting, not just vector-file size.** Measure process memory after
  model/index load and during simultaneous scans plus a save. Account for vectors,
  catalog maps, model tensors and decoded photos. Evaluate 2 GiB initially—not
  a proven minimum—and choose capacity from load tests.
  Measure cold boot, first authenticated scan and warm p50/p95 on the actual
  deployment size. Current phone tests do not establish production cold-start
  time. Gate readiness on initialization and bound request queues.
- [ ] **Require real acceptance evidence.** Finish Colossus's same-photo before/after
  ranks; explain Ghost Rider using fresh results. Run the signed-in gap-fill journey:
  search → Add → explicit upload → queue → approval → new image/vector → independent
  camera scan finds it. Verify matched Add never uploads or creates a review item,
  trusted uploaders queue, wrong-image reports work without attachments, and
  ordinary collection/XP/badge behavior still works. Binder scanning is excluded.
- [ ] **Prepare rollback before enabling.** Keep the prior app build and prior
  checksummed model/index pair; keep old Cloudinary assets and image audit history.
  First disable the scanner flag, then restore the compatible app/index pair.
  Code rollback does **not** undo committed image approvals or deleted catalog rows:
  use the audited correction path or a separately approved database restore/repair.
  Test rollback in staging and define who approves production enablement.

Platform references: Replit publishing overview, machine configuration, and
checkpoints/rollbacks documentation. Autoscale local writes are not durable storage.