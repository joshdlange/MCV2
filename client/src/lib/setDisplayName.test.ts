import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMainSetName, getCardSetDisplayName } from "./setDisplayName";

test("bare subsets do not become their own parent or Base Set", () => {
  for (const cardSetName of ["Astonishing", "Canvas", "Gold Foil Parallel", "Unknown Set"]) {
    assert.equal(extractMainSetName(cardSetName), undefined);
    assert.deepEqual(getCardSetDisplayName({ cardSetName, isAdmin: false }), {
      displayName: cardSetName, isBaseSet: false,
    });
  }
});

test("full combo subsets retain their complete name, including further delimiters", () => {
  const cardSetName = "Marvel Platinum - Astonishing - Rainbow Foil";
  assert.equal(extractMainSetName(cardSetName), "Marvel Platinum");
  assert.deepEqual(getCardSetDisplayName({ cardSetName, isAdmin: false }), {
    displayName: "Astonishing - Rainbow Foil", isBaseSet: false,
  });
});

test("known parent base conventions remain Base Set", () => {
  for (const cardSetName of ["Marvel Platinum", "Marvel Platinum - Marvel Platinum", "Marvel Platinum - Base", "Marvel Platinum - base set"]) {
    assert.deepEqual(getCardSetDisplayName({ cardSetName, mainSetName: "Marvel Platinum", isAdmin: false }), {
      displayName: "Base Set", isBaseSet: true,
    });
  }
});

test("known parents are authoritative and bare subset names stay intact", () => {
  for (const cardSetName of ["Astonishing", "Another Parent - Astonishing"]) {
    assert.deepEqual(getCardSetDisplayName({ cardSetName, mainSetName: "Marvel Platinum", isAdmin: false }), {
      displayName: cardSetName, isBaseSet: false,
    });
  }
});

test("admin displays preserve original names without base badges", () => {
  const cardSetName = "Marvel Platinum - Base";
  assert.deepEqual(getCardSetDisplayName({ cardSetName, mainSetName: "Marvel Platinum", isAdmin: true }), {
    displayName: cardSetName, isBaseSet: false,
  });
});
