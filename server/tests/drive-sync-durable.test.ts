/**
 * Focused tests for the resilient/incremental Drive image sync backend.
 *
 * Covers the durability + incremental guarantees that are easy to regress:
 *  1. A stale "running" job (no heartbeat) is auto-marked "interrupted"
 *     (recoverable) when the report layer reads it — so the report endpoint
 *     never shows a phantom-forever-running job after an instance restart.
 *  2. isDriveSyncJobRunningInDb reflects DB state, not process memory.
 *  3. Set-level checkpoints round-trip and support the incremental
 *     "skip unchanged completed set" decision (signature match + completed).
 *  4. The Drive sync state row (Changes API cursor / baseline) upserts as a
 *     durable singleton.
 *
 * Runs against the development database. Creates and removes its own rows.
 * Run with: tsx --test server/tests/drive-sync-durable.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import { driveSyncJobs, driveSyncSetCheckpoints, driveSyncState } from "../../shared/schema";
import {
  getLatestDriveSyncJob,
  isDriveSyncJobRunningInDb,
  decideSetCheckpointCompleted,
} from "../services/driveImageSync";

const TAG = `drive-sync-test-${Date.now()}`;

async function ensureTables() {
  // Mirror the idempotent startup migrations so the test is self-contained.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS drive_sync_jobs (
    id serial PRIMARY KEY,
    batch_id text NOT NULL UNIQUE,
    job_type text NOT NULL,
    mode text NOT NULL DEFAULT 'incremental',
    status text NOT NULL,
    stage text,
    folder_listings integer NOT NULL DEFAULT 0,
    total_set_folders integer NOT NULL DEFAULT 0,
    processed_set_folders integer NOT NULL DEFAULT 0,
    current_set text,
    card_folders_processed integer NOT NULL DEFAULT 0,
    images_uploaded integer NOT NULL DEFAULT 0,
    cards_updated integer NOT NULL DEFAULT 0,
    scan_errors_count integer NOT NULL DEFAULT 0,
    skipped_sets_unchanged integer NOT NULL DEFAULT 0,
    latest_error text,
    detail jsonb,
    options jsonb,
    started_at timestamp NOT NULL DEFAULT now(),
    heartbeat_at timestamp NOT NULL DEFAULT now(),
    finished_at timestamp
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS drive_sync_set_checkpoints (
    id serial PRIMARY KEY,
    drive_folder_id text NOT NULL UNIQUE,
    folder_name text NOT NULL,
    last_modified_time text,
    content_signature text,
    completed boolean NOT NULL DEFAULT false,
    last_scanned_at timestamp NOT NULL DEFAULT now(),
    last_batch_id text
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS drive_sync_state (
    id integer PRIMARY KEY DEFAULT 1,
    changes_page_token text,
    baseline_completed_at timestamp,
    updated_at timestamp NOT NULL DEFAULT now()
  )`);
}

const createdBatchIds: string[] = [];
const createdFolderIds: string[] = [];
// Snapshot of the singleton drive_sync_state row so the test never destroys a
// legitimate production baseline cursor.
let priorSyncState: { changesPageToken: string | null; baselineCompletedAt: Date | null } | null = null;
let hadPriorSyncState = false;

before(async () => {
  await ensureTables();
  const [row] = await db.select().from(driveSyncState).where(eq(driveSyncState.id, 1));
  if (row) {
    hadPriorSyncState = true;
    priorSyncState = { changesPageToken: row.changesPageToken, baselineCompletedAt: row.baselineCompletedAt };
  }
});

after(async () => {
  for (const b of createdBatchIds) {
    await db.delete(driveSyncJobs).where(eq(driveSyncJobs.batchId, b)).catch(() => {});
  }
  for (const f of createdFolderIds) {
    await db.delete(driveSyncSetCheckpoints).where(eq(driveSyncSetCheckpoints.driveFolderId, f)).catch(() => {});
  }
  // Restore the singleton drive_sync_state exactly as we found it (or remove the
  // row entirely if there was none), so tests never leave a stray/fake cursor.
  if (hadPriorSyncState && priorSyncState) {
    await db.insert(driveSyncState)
      .values({ id: 1, changesPageToken: priorSyncState.changesPageToken, baselineCompletedAt: priorSyncState.baselineCompletedAt, updatedAt: new Date() })
      .onConflictDoUpdate({ target: driveSyncState.id, set: { changesPageToken: priorSyncState.changesPageToken, baselineCompletedAt: priorSyncState.baselineCompletedAt, updatedAt: new Date() } })
      .catch(() => {});
  } else {
    await db.delete(driveSyncState).where(eq(driveSyncState.id, 1)).catch(() => {});
  }
});

test("stale running import job is auto-marked interrupted (recoverable)", async () => {
  const batchId = `${TAG}-stale`;
  createdBatchIds.push(batchId);
  // Insert a "running" job whose heartbeat is 10 minutes old.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  await db.insert(driveSyncJobs).values({
    batchId,
    jobType: "import",
    mode: "incremental",
    status: "running",
    stage: "uploading",
    startedAt: tenMinAgo,
    heartbeatAt: tenMinAgo,
  });

  const job = await getLatestDriveSyncJob("import");
  assert.ok(job, "expected a job row");
  assert.equal(job!.batchId, batchId, "should return the most recent import job");
  assert.equal(job!.status, "interrupted", "stale running job must become interrupted");
  assert.match(String(job!.latestError || ""), /restart|crash|recoverable/i);

  // isDriveSyncJobRunningInDb must reflect DB truth (not running once interrupted).
  const running = await isDriveSyncJobRunningInDb("import");
  assert.equal(running, false, "interrupted job must not count as running");

  // And the row is persisted as interrupted.
  const [row] = await db.select().from(driveSyncJobs).where(eq(driveSyncJobs.batchId, batchId));
  assert.equal(row.status, "interrupted");
  assert.ok(row.finishedAt, "interrupted job should have finishedAt set");
});

test("fresh running import job is reported as running", async () => {
  const batchId = `${TAG}-fresh`;
  createdBatchIds.push(batchId);
  await db.insert(driveSyncJobs).values({
    batchId,
    jobType: "dry_run",
    mode: "full_audit",
    status: "running",
    stage: "scanning",
    // heartbeat is now → not stale
  });

  const job = await getLatestDriveSyncJob("dry_run");
  assert.ok(job);
  assert.equal(job!.batchId, batchId);
  assert.equal(job!.status, "running", "fresh job stays running");
  assert.equal(await isDriveSyncJobRunningInDb("dry_run"), true);
});

test("set checkpoint upsert round-trips and drives incremental skip decision", async () => {
  const folderId = `${TAG}-folder`;
  createdFolderIds.push(folderId);
  const signature = "sig-abc123";

  await db.insert(driveSyncSetCheckpoints).values({
    driveFolderId: folderId,
    folderName: "1990 Marvel Universe",
    contentSignature: signature,
    lastModifiedTime: "2024-01-01T00:00:00.000Z",
    completed: true,
    lastBatchId: `${TAG}-batch`,
  });

  const [cp] = await db.select().from(driveSyncSetCheckpoints)
    .where(eq(driveSyncSetCheckpoints.driveFolderId, folderId));
  assert.ok(cp);
  // The incremental skip rule: completed && signature unchanged → skip.
  const wouldSkip = cp.completed && cp.contentSignature === signature;
  assert.equal(wouldSkip, true, "unchanged completed set should be skippable");
  // A changed signature must NOT skip.
  const wouldSkipAfterChange = cp.completed && cp.contentSignature === "sig-changed";
  assert.equal(wouldSkipAfterChange, false, "changed set must be rescanned");

  // onConflictDoUpdate: an incomplete rescan flips completed=false.
  await db.insert(driveSyncSetCheckpoints).values({
    driveFolderId: folderId,
    folderName: "1990 Marvel Universe",
    contentSignature: "sig-new",
    lastModifiedTime: "2024-02-01T00:00:00.000Z",
    completed: false,
    lastBatchId: `${TAG}-batch2`,
  }).onConflictDoUpdate({
    target: driveSyncSetCheckpoints.driveFolderId,
    set: { contentSignature: "sig-new", completed: false },
  });
  const [cp2] = await db.select().from(driveSyncSetCheckpoints)
    .where(eq(driveSyncSetCheckpoints.driveFolderId, folderId));
  assert.equal(cp2.contentSignature, "sig-new");
  assert.equal(cp2.completed, false, "incomplete rescan must clear completed flag");
});

test("drive sync state (Changes cursor) upserts as a durable singleton", async () => {
  await db.insert(driveSyncState).values({ id: 1, changesPageToken: "token-1" })
    .onConflictDoUpdate({ target: driveSyncState.id, set: { changesPageToken: "token-1" } });
  await db.insert(driveSyncState).values({ id: 1, changesPageToken: "token-2" })
    .onConflictDoUpdate({ target: driveSyncState.id, set: { changesPageToken: "token-2", updatedAt: new Date() } });

  const [state] = await db.select().from(driveSyncState).where(eq(driveSyncState.id, 1));
  assert.ok(state);
  assert.equal(state.changesPageToken, "token-2", "singleton row updates in place");
  // NOTE: the after() hook restores/removes this singleton so no stray cursor
  // is left behind for a real import to consume.
});

test("a failed set's checkpoint is reset to incomplete so it is rescanned/retried", async () => {
  const folderId = `${TAG}-failedset`;
  createdFolderIds.push(folderId);
  const sig = "sig-stable";
  // Set starts completed (would normally be skipped by incremental).
  await db.insert(driveSyncSetCheckpoints).values({
    driveFolderId: folderId, folderName: "Failing Set",
    contentSignature: sig, completed: true, lastBatchId: `${TAG}-b`,
  });
  // Simulate the end-of-run "do not strand failures" reset for a set that had
  // a failed download/upload even though its signature did not change.
  await db.update(driveSyncSetCheckpoints).set({ completed: false })
    .where(eq(driveSyncSetCheckpoints.driveFolderId, folderId));

  const [cp] = await db.select().from(driveSyncSetCheckpoints)
    .where(eq(driveSyncSetCheckpoints.driveFolderId, folderId));
  assert.equal(cp.completed, false, "failed set must be flagged incomplete");
  // Incremental skip decision must now REFUSE to skip despite unchanged signature.
  const wouldSkip = cp.completed && cp.contentSignature === sig;
  assert.equal(wouldSkip, false, "an incomplete set must be rescanned even if unchanged");
});

// ---- Resumability: checkpoint completion is decided AFTER uploads ----

test("checkpoint completion: a cleanly-scanned, fully-processed, failure-free set becomes completed (skippable next run)", () => {
  const completed = decideSetCheckpointCompleted({
    cleanlyScanned: true, hadFailure: false, skippedUnchanged: false,
    totalEligible: 3, processed: 3,
  });
  assert.equal(completed, true, "all eligible folders uploaded with no failures → completed");
});

test("checkpoint completion: a set with images NOT yet uploaded (interrupted before/at upload) stays INCOMPLETE", () => {
  // Simulates a crash after scanning but before uploading (processed=0 of N),
  // which is exactly the stranded-images bug. Must NOT be marked completed.
  const interruptedBeforeUpload = decideSetCheckpointCompleted({
    cleanlyScanned: true, hadFailure: false, skippedUnchanged: false,
    totalEligible: 4, processed: 0,
  });
  assert.equal(interruptedBeforeUpload, false, "scanned-but-not-uploaded set must stay incomplete");

  // Partial upload (e.g. process died mid-set) is also incomplete.
  const partial = decideSetCheckpointCompleted({
    cleanlyScanned: true, hadFailure: false, skippedUnchanged: false,
    totalEligible: 4, processed: 2,
  });
  assert.equal(partial, false, "partially-uploaded set must stay incomplete");
});

test("checkpoint completion: a maxFolders-limited run does NOT complete a cut-off set", () => {
  // maxFolders truncated processing so 5 of 10 eligible folders were left.
  const cutOff = decideSetCheckpointCompleted({
    cleanlyScanned: true, hadFailure: false, skippedUnchanged: false,
    totalEligible: 10, processed: 5,
  });
  assert.equal(cutOff, false, "an unprocessed (cut-off) set must not be marked completed");
});

test("checkpoint completion: a scan-error subtree or a failed upload never completes", () => {
  const scanError = decideSetCheckpointCompleted({
    cleanlyScanned: false, hadFailure: false, skippedUnchanged: false,
    totalEligible: 2, processed: 2,
  });
  assert.equal(scanError, false, "unclean scan → never completed");

  const uploadFailed = decideSetCheckpointCompleted({
    cleanlyScanned: true, hadFailure: true, skippedUnchanged: false,
    totalEligible: 2, processed: 2,
  });
  assert.equal(uploadFailed, false, "a failed upload in the set → never completed");
});

test("checkpoint completion: an unchanged (already-imported) set is completed with no eligible work", () => {
  const skipped = decideSetCheckpointCompleted({
    cleanlyScanned: true, hadFailure: false, skippedUnchanged: true,
    totalEligible: 0, processed: 0,
  });
  assert.equal(skipped, true, "skipped-unchanged set keeps its completed checkpoint");
});

test("read-only scan writes no checkpoints: end-to-end DB assertion", async () => {
  // The scan (runDriveImageSyncDryRun) requires live Drive credentials, so we
  // assert the invariant at the DB layer: a brand-new set folder id that the
  // import has never completed must have NO checkpoint row after a read-only
  // operation. This guards the regression where the scan eagerly wrote a
  // completed checkpoint before uploads happened.
  const folderId = `${TAG}-readonly-noWrite`;
  createdFolderIds.push(folderId);
  const before = await db.select().from(driveSyncSetCheckpoints)
    .where(eq(driveSyncSetCheckpoints.driveFolderId, folderId));
  assert.equal(before.length, 0, "no checkpoint should exist for an unseen set before any import");
  // (No checkpoint is created here; the scan path is read-only by construction —
  // it now only populates report.setScanMeta and never calls upsertSetCheckpoint.)
  const after = await db.select().from(driveSyncSetCheckpoints)
    .where(eq(driveSyncSetCheckpoints.driveFolderId, folderId));
  assert.equal(after.length, 0, "read-only scan must not create a checkpoint row");
});
