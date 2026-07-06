// Test harness for the Scan to Add matching engine (server/services/scanMatching.ts).
// Exercises matchCandidates() directly against the real database — no OpenAI calls.
// Run with: tsx scripts/test-scan-matching.ts

import { matchCandidates, type ParsedScan } from "../server/services/scanMatching";

interface TestCase {
  name: string;
  parsed: ParsedScan;
  expectCardId?: number;
  expectConfidenceAtLeast?: "high" | "medium" | "low";
}

function emptyParsed(overrides: Partial<ParsedScan>): ParsedScan {
  return {
    characterName: null,
    setName: null,
    subsetName: null,
    cardNumber: null,
    year: null,
    brand: null,
    variant: null,
    copyrightLine: null,
    serialIndicator: null,
    keywords: [],
    ...overrides,
  };
}

const CONFIDENCE_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };

const cases: TestCase[] = [
  {
    name: "Exact character + set + card number (Black Widow, 1992 Masterpieces #3)",
    parsed: emptyParsed({
      characterName: "Black Widow",
      setName: "Marvel Masterpieces",
      cardNumber: "3",
      year: "1992",
    }),
    expectCardId: 11,
    expectConfidenceAtLeast: "high",
  },
  {
    name: "Exact character + card number, no set name (Black Panther #4)",
    parsed: emptyParsed({
      characterName: "Black Panther",
      cardNumber: "4",
      year: "1992",
    }),
    expectCardId: 12,
    expectConfidenceAtLeast: "medium",
  },
  {
    name: "OCR typo in set name ('Metai Universe' -> metal universe alias)",
    parsed: emptyParsed({
      characterName: "Captain America",
      setName: "Metai Universe",
      cardNumber: "16",
      year: "1992",
    }),
    expectConfidenceAtLeast: "low",
  },
  {
    name: "Insert subset card with dash suffix (Thing vs. Hulk, 1-D)",
    parsed: emptyParsed({
      characterName: "Thing",
      cardNumber: "1-D",
      year: "1992",
    }),
    expectCardId: 109,
    expectConfidenceAtLeast: "medium",
  },
  {
    name: "Insert card with S-prefix number (Meanstreak, S1)",
    parsed: emptyParsed({
      characterName: "Meanstreak",
      cardNumber: "S1",
      year: "1993",
    }),
    expectCardId: 204,
    expectConfidenceAtLeast: "medium",
  },
  {
    name: "Card number formatted as 'X of Y' (Captain America, 1 of 10)",
    parsed: emptyParsed({
      characterName: "Captain America",
      cardNumber: "1 of 10",
      year: "1994",
    }),
    expectCardId: 352,
    expectConfidenceAtLeast: "low",
  },
  {
    name: "Character name only, no card number or set (ambiguous — Daredevil)",
    parsed: emptyParsed({
      characterName: "Daredevil",
    }),
    expectConfidenceAtLeast: "low",
  },
  {
    name: "Wrong year hint but correct character + number (should still find via number/name)",
    parsed: emptyParsed({
      characterName: "Cyclops",
      cardNumber: "13",
      year: "1999",
    }),
    expectCardId: 21,
  },
  {
    name: "Keywords only, no structured character name (fallback path)",
    parsed: emptyParsed({
      keywords: ["cable", "masterpieces"],
      year: "1992",
    }),
  },
  {
    name: "Completely garbage OCR input (should yield no/low confidence match)",
    parsed: emptyParsed({
      characterName: "Xyzzy Nonexistent Hero",
      setName: "Not A Real Set",
      cardNumber: "999999",
      year: "1888",
    }),
    expectConfidenceAtLeast: undefined,
  },
  {
    name: "Card number with '#' prefix noise (Bishop #6)",
    parsed: emptyParsed({
      characterName: "Bishop",
      cardNumber: "#6",
      year: "1992",
    }),
    expectCardId: 14,
    expectConfidenceAtLeast: "medium",
  },
  {
    name: "Set alias 'skybox marvel universe' -> universe",
    parsed: emptyParsed({
      characterName: "Beast",
      setName: "Skybox Marvel Universe",
      cardNumber: "7",
      year: "1992",
    }),
    expectConfidenceAtLeast: "low",
  },
];

async function run() {
  let passed = 0;
  let failed = 0;

  for (const tc of cases) {
    console.log(`\n=== ${tc.name} ===`);
    console.log("Input parsed:", JSON.stringify(tc.parsed));

    let matches;
    try {
      matches = await matchCandidates(tc.parsed);
    } catch (err) {
      console.error("  ERROR calling matchCandidates:", err);
      failed++;
      continue;
    }

    if (matches.length === 0) {
      console.log("  No candidates returned.");
    } else {
      matches.slice(0, 5).forEach((m, i) => {
        console.log(
          `  [${i}] cardId=${m.cardId} "${m.name}" (${m.setName} #${m.cardNumber}, ${m.year}) ` +
          `score=${m.confidence.toFixed(1)} level=${m.confidenceLevel} reasons=[${m.matchReasons.join(", ")}]`
        );
      });
    }

    let caseOk = true;

    if (tc.expectCardId !== undefined) {
      const top = matches[0];
      if (!top || top.cardId !== tc.expectCardId) {
        console.log(`  FAIL: expected top match cardId=${tc.expectCardId}, got ${top?.cardId ?? "none"}`);
        caseOk = false;
      }
    }

    if (tc.expectConfidenceAtLeast) {
      const top = matches[0];
      const topLevel = top?.confidenceLevel ?? "none";
      if (CONFIDENCE_RANK[topLevel] < CONFIDENCE_RANK[tc.expectConfidenceAtLeast]) {
        console.log(`  FAIL: expected confidence >= ${tc.expectConfidenceAtLeast}, got ${topLevel}`);
        caseOk = false;
      }
    }

    if (caseOk) {
      console.log("  PASS");
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\n\n${passed}/${cases.length} cases passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal error running test harness:", err);
  process.exit(1);
});
