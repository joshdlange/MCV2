import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { cardNumberNaturalSortKey } from "../cardNumberSort";

test("database card-number ordering is natural for numeric prefixes and segments", async () => {
  const result = await db.execute(sql`
    SELECT card_number
    FROM (
      VALUES
        ('AU-24'),
        ('11'),
        ('AU-4'),
        ('A1-11'),
        ('2'),
        ('AU-25'),
        ('1'),
        ('A1-2'),
        ('AU-3'),
        ('12')
    ) AS samples(card_number)
    ORDER BY
      ${cardNumberNaturalSortKey(sql`samples.card_number`)},
      lower(samples.card_number)
  `);

  assert.deepEqual(
    result.rows.map((row: any) => row.card_number),
    [
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
    ],
  );
});