import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMainSetName, getCardSetDisplayName, getCardSetIdentity } from "./setDisplayName";

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

test("known parent base conventions display Base Cards", () => {
  for (const cardSetName of ["Marvel Platinum", "Marvel Platinum - Marvel Platinum", "Marvel Platinum - Base", "Marvel Platinum - base set"]) {
    assert.deepEqual(getCardSetDisplayName({ cardSetName, mainSetName: "Marvel Platinum", isAdmin: false }), {
      displayName: "Base Cards", isBaseSet: true,
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

test("Nahuel Grego repeated title becomes separate master and Base Cards", () => {
  const master = "2024 Upper Deck Marvel Masterpieces Nahuel Grego";
  assert.deepEqual(getCardSetIdentity(`${master} - ${master}`, master), {
    masterName: master, subsetName: "Base Cards",
  });
  assert.deepEqual(getCardSetIdentity(`${master} - ${master}`), {
    masterName: master, subsetName: "Base Cards",
  });
});

test("identity preserves named parallels and ambiguous standalone subsets", () => {
  assert.deepEqual(getCardSetIdentity("Marvel Platinum - Canvas Gallery Gold", "Marvel Platinum"), {
    masterName: "Marvel Platinum", subsetName: "Canvas Gallery Gold",
  });
  assert.deepEqual(getCardSetIdentity("Astonishing"), {
    masterName: undefined, subsetName: "Astonishing",
  });
  assert.deepEqual(getCardSetIdentity("Release - Part Two - Gold", "Release - Part Two"), {
    masterName: "Release - Part Two", subsetName: "Gold",
  });
});
