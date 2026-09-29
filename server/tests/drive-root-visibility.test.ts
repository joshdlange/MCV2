import { test } from "node:test";
import assert from "node:assert/strict";
import { describeDirectRootSetVisibility, resolveDriveImageSides } from "../services/driveImageSync";

test("reports root-direct DB sets not visible to the service account without claiming absence", () => {
  const visibility = describeDirectRootSetVisibility(
    [{ name: "2025 Topps Chrome Marvel " }, { name: "Marvel Card Images " }],
    [
      { id: 1, name: "2025 Topps Chrome Marvel" },
      { id: 525, name: "2026 Topps Chrome Marvel Comics" },
    ],
  );
  assert.deepEqual(visibility.visibleUnmatchedRootFolders, ["Marvel Card Images "]);
  assert.deepEqual(visibility.databaseMainSetsNotVisibleAsDirectChildren, [
    { id: 525, name: "2026 Topps Chrome Marvel Comics" },
  ]);
});

test("two-image imports never assign sides from sort order alone", () => {
  assert.equal(resolveDriveImageSides([
    { id: "a", name: "79.jpg", mimeType: "image/jpeg" },
    { id: "b", name: "79-2.jpg", mimeType: "image/jpeg" },
  ]), null);
  assert.deepEqual(resolveDriveImageSides([
    { id: "a", name: "79 BACK.jpg", mimeType: "image/jpeg" },
    { id: "b", name: "79.jpg", mimeType: "image/jpeg" },
  ])?.map(x => [x.side, x.file.id]), [["front", "b"], ["back", "a"]]);
});