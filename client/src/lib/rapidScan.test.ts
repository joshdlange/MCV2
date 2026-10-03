import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRapidRecognition, rapidCanUndo, rapidDuplicateIds, rapidSuggestedCard, RAPID_QUEUE_LIMIT, RAPID_SESSION_LIMIT, type RapidItem, type RapidRecognition } from "./rapidScan";

const card = { cardId: 7, name: "Storm", setName: "QA Collection", subsetName: null, cardNumber: "38", year: 1995, imageUrl: null, mainSetId: 1 };
const strong: RapidRecognition = { mode: "visual-v1", topScore: .93, margin: .11, families: [{ familyKey: "storm", score: .93, representativeCardId: 7, options: [card] }] };
test("strong match requires score AND separation; missing/low/NaN never selects", () => {
  assert.equal(classifyRapidRecognition(strong).selected?.cardId, 7);
  for (const change of [{ topScore: .71 }, { margin: .02 }, { margin: null }, { topScore: NaN }, { margin: NaN }]) {
    const result = classifyRapidRecognition({ ...strong, ...change });
    assert.equal(result.status, "check"); assert.equal(result.selected, undefined);
  }
});
test("same artwork in different sets / years NEVER auto-selects, even perfect score", () => {
  for (const second of [{ ...card, cardId: 8, mainSetId: 2 }, { ...card, cardId: 8, year: 1996 }]) {
    const result = classifyRapidRecognition({ ...strong, topScore: 1, margin: .5, families: [{ ...strong.families[0], options: [card, second] }] });
    assert.equal(result.status, "check"); assert.equal(result.selected, undefined);
    assert.equal(result.families[0].options.length, 2);
  }
});
test("parallel choice is conservative; no results is not found; legacy is rejected", () => {
  assert.equal(classifyRapidRecognition({ ...strong, families: [{ ...strong.families[0], options: [card, { ...card, cardId: 8, subsetName: "Gold" }] }] }).selected, undefined);
  assert.equal(classifyRapidRecognition({ ...strong, families: [] }).status, "notfound");
  assert.throws(() => classifyRapidRecognition({ ...strong, mode: "legacy" }), /visual recognition/);
});
test("suggested representative is visible but remains entirely separate from selection", () => {
  const result = classifyRapidRecognition({ ...strong, margin: .01 });
  const row: RapidItem = { id: "qa-suggestion", input: { file: {} as File, source: "pocket" }, previewUrl: "blob:qa", ...result };
  assert.equal(rapidSuggestedCard(row)?.cardId, 7);
  assert.equal(row.selected, undefined);
  assert.equal(rapidDuplicateIds([row]).size, 0);
});
const item = (id: string, selected = card): RapidItem => ({ id, input: { file: {} as File, source: "pocket", producerItemKey: `page-1:${id}` }, previewUrl: "blob:qa", status: "check", families: [], selected });
test("future producer contract is independent of camera and deduplicates catalog identity", () => {
  const pocket = [item("pocket-1"), item("pocket-2"), item("pocket-3", { ...card, cardId: 9 })];
  assert.deepEqual([...rapidDuplicateIds(pocket)], ["pocket-2"]);
  assert.equal(RAPID_QUEUE_LIMIT, 9); assert.equal(RAPID_SESSION_LIMIT, 18);
});
test("undo requires a new owned row, matching identity and an actual returned token", () => {
  const row = item("a");
  const save = { created: true, ownedRow: { id: 47, cardId: 7 }, undoToken: "returned-token" };
  assert.ok(rapidCanUndo({ ...row, save }));
  for (const change of [{ created: false }, { undoToken: null }, { undoToken: "" }, { ownedRow: { id: 47, cardId: 8 } }, { ownedRow: { id: -1, cardId: 7 } }])
    assert.equal(rapidCanUndo({ ...row, save: { ...save, ...change } }), false);
  assert.equal(rapidCanUndo({ ...row, save, undone: true }), false);
});