import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("retired Drive endpoints return 410 without calling the connector", () => {
  const routes = source("../routes.ts");
  assert.match(routes, /app\.all\("\/api\/admin\/drive-sync\/\*", authenticateUser/);
  assert.match(routes, /res\.status\(410\)\.json\(\{ message: 'Google Drive image sync has been retired/);
  assert.doesNotMatch(routes, /import\(['"]\.\/services\/driveImageSync['"]\)/);
  assert.doesNotMatch(routes, /app\.(?:get|post)\("\/api\/admin\/drive-sync\//);
});

test("Drive sync cannot start on boot or from Image Automation", () => {
  const startup = source("../index.ts");
  const automation = source("../../client/src/pages/admin/automation.tsx");
  assert.doesNotMatch(startup, /run_drive_(?:dryrun|cleanup|import_test)|import\(['"]\.\/services\/driveImageSync['"]\)/);
  assert.doesNotMatch(automation, /drive-sync|DriveSyncCard|Drive Image Sync/);
  assert.match(automation, /ImageMigrationCard/);
});

test("retirement retains existing import history tables", () => {
  const startup = source("../index.ts");
  assert.match(startup, /CREATE TABLE IF NOT EXISTS drive_image_imports/);
  assert.match(startup, /CREATE TABLE IF NOT EXISTS drive_sync_jobs/);
});