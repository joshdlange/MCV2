import { test } from "node:test";
import assert from "node:assert/strict";
import { selectImageAdmin } from "./imageAdminSelection";

const editors = [
  { id: 1, username: "admin" },
  { id: 2, username: "yours_sincerely2006" },
  { id: 3, username: "other-editor" },
];
test("defaults to the requested editor, never the first admin", () => {
  assert.equal(selectImageAdmin(editors, null)?.id, 2);
  assert.equal(selectImageAdmin([editors[0]], null), undefined);
});
test("explicit selection survives reordered and refreshed editor lists", () => {
  assert.equal(selectImageAdmin(editors, "3")?.id, 3);
  assert.equal(selectImageAdmin([...editors].reverse().map(editor => ({ ...editor })), "3")?.id, 3);
});
test("temporary missing data never substitutes another user's counts", () => {
  assert.equal(selectImageAdmin([], "3"), undefined);
  assert.equal(selectImageAdmin(editors.slice(0, 2), "3"), undefined);
  assert.equal(selectImageAdmin(editors, "3")?.id, 3);
});
