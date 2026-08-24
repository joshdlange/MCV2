import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { cards, cardSets, mainSets } from '../../shared/schema';

type ChecklistDefinition = {
  name: string;
  isInsert: boolean;
  cards: Array<{ num: string; name: string; isInsert?: boolean }>;
};

/**
 * A precise startup no-op check. Aggregate card totals are not sufficient:
 * duplicates in one subset can otherwise conceal missing cards in another.
 */
export async function areExpectedChecklistsComplete(
  mainSetSlug: string,
  mainSetName: string,
  year: number,
  subsets: readonly ChecklistDefinition[],
  subsetSlug: (name: string) => string,
): Promise<boolean> {
  const expectedBySlug = new Map(
    subsets.map((subset) => [subsetSlug(subset.name), subset.cards]),
  );
  const expectedSlugs = [...expectedBySlug.keys()];

  const rows = await db.select({
    subsetSlug: cardSets.slug,
    subsetName: cardSets.name,
    subsetYear: cardSets.year,
    subsetTotalCards: cardSets.totalCards,
    subsetIsInsert: cardSets.isInsertSubset,
    subsetIsCanonical: cardSets.isCanonical,
    cardNumber: cards.cardNumber,
    cardName: cards.name,
    cardIsInsert: cards.isInsert,
    cardRarity: cards.rarity,
  })
    .from(cardSets)
    .innerJoin(mainSets, eq(mainSets.id, cardSets.mainSetId))
    .leftJoin(cards, and(
      eq(cards.setId, cardSets.id),
      isNull(cards.archivedAt),
    ))
    .where(and(
      eq(mainSets.slug, mainSetSlug),
      eq(mainSets.name, mainSetName),
      eq(mainSets.isActive, true),
      eq(mainSets.isCanonical, true),
      isNull(mainSets.archivedAt),
      eq(cardSets.isActive, true),
      isNull(cardSets.archivedAt),
      inArray(cardSets.slug, expectedSlugs),
    ));

  const actualBySlug = new Map<string, {
    name: string;
    year: number;
    totalCards: number;
    isInsert: boolean;
    isCanonical: boolean;
    cards: Array<{
      number: string;
      name: string;
      isInsert: boolean;
      rarity: string;
    }>;
  }>();
  for (const row of rows) {
    let actual = actualBySlug.get(row.subsetSlug);
    if (!actual) {
      actual = {
        name: row.subsetName,
        year: row.subsetYear,
        totalCards: row.subsetTotalCards,
        isInsert: row.subsetIsInsert,
        isCanonical: row.subsetIsCanonical,
        cards: [],
      };
      actualBySlug.set(row.subsetSlug, actual);
    }
    if (
      row.cardNumber != null
      && row.cardName != null
      && row.cardIsInsert != null
      && row.cardRarity != null
    ) {
      actual.cards.push({
        number: row.cardNumber,
        name: row.cardName,
        isInsert: row.cardIsInsert,
        rarity: row.cardRarity,
      });
    }
  }

  for (const [slug, expectedCards] of expectedBySlug) {
    const expectedSubset = subsets.find((subset) => subsetSlug(subset.name) === slug);
    const actual = actualBySlug.get(slug);
    if (
      !expectedSubset
      || !actual
      || actual.name !== expectedSubset.name
      || actual.year !== year
      || actual.totalCards !== expectedCards.length
      || actual.isInsert !== expectedSubset.isInsert
      || !actual.isCanonical
      || actual.cards.length !== expectedCards.length
    ) {
      return false;
    }

    const expectedByNumber = new Map(expectedCards.map((card) => [card.num, card]));
    const actualNumberSet = new Set(actual.cards.map((card) => card.number));
    if (
      actualNumberSet.size !== expectedByNumber.size
      || actual.cards.some((card) => {
        const expected = expectedByNumber.get(card.number);
        const expectedIsInsert = expected?.isInsert ?? expectedSubset.isInsert;
        return !expected
          || card.name !== expected.name
          || card.isInsert !== expectedIsInsert
          || card.rarity !== (expectedIsInsert ? 'Insert' : 'Common');
      })
    ) {
      return false;
    }
  }

  return actualBySlug.size === expectedBySlug.size;
}