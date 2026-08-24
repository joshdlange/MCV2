export type ParallelCardDefinition = {
  num: string;
  name: string;
};

export type ParallelSubsetDefinition<Card extends ParallelCardDefinition> = {
  name: string;
  isInsert: boolean;
  cards: Card[];
};

/**
 * Adds checklist variants by cloning only the source definition's card data.
 * The source JSON contains no image fields, so generated parallel rows cannot
 * accidentally inherit base-card images.
 */
export function appendParallelVariants<
  Card extends ParallelCardDefinition,
  Subset extends ParallelSubsetDefinition<Card>,
>(
  subsets: readonly Subset[],
  sourceName: string,
  variantNames: readonly string[],
): Subset[] {
  const sourceMatches = subsets.filter((subset) => subset.name === sourceName);
  if (sourceMatches.length !== 1) {
    throw new Error(
      `Parallel source "${sourceName}" must exist exactly once; found ${sourceMatches.length}`,
    );
  }

  const source = sourceMatches[0];
  if (source.cards.length === 0) {
    throw new Error(`Parallel source "${sourceName}" has no cards`);
  }

  const sourceNumbers = new Set<string>();
  for (const card of source.cards) {
    const number = card.num.trim();
    if (!number || !card.name.trim()) {
      throw new Error(`Parallel source "${sourceName}" contains a blank card number or name`);
    }
    if (sourceNumbers.has(number)) {
      throw new Error(`Parallel source "${sourceName}" contains duplicate card number "${number}"`);
    }
    sourceNumbers.add(number);
  }

  const existingNames = new Set(subsets.map((subset) => subset.name));
  const requestedNames = new Set<string>();
  for (const name of variantNames) {
    if (!name.trim() || existingNames.has(name) || requestedNames.has(name)) {
      throw new Error(`Parallel variant name "${name}" is blank or duplicated`);
    }
    requestedNames.add(name);
  }

  const variants = variantNames.map((name) => ({
    ...source,
    name,
    cards: source.cards.map((card) => ({ ...card })),
  } as Subset));

  return [...subsets, ...variants];
}