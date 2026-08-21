import test from "node:test";
import assert from "node:assert/strict";
import { compareCardNumbers } from "./cardNumberSort";

test("sorts plain and prefixed card numbers by each numeric segment", () => {
  const cardNumbers = [
    "AU-24",
    "11",
    "AU-4",
    "A1-11",
    "2",
    "AU-25",
    "1",
    "A1-2",
    "AU-3",
    "12",
  ];

  assert.deepEqual(cardNumbers.sort(compareCardNumbers), [
    "1",
    "2",
    "11",
    "12",
    "A1-2",
    "A1-11",
    "AU-3",
    "AU-4",
    "AU-24",
    "AU-25",
  ]);
});