interface GetDisplayNameParams {
  cardSetName: string;
  mainSetName?: string | null;
  isAdmin: boolean;
}

export function getCardSetDisplayName({ cardSetName, mainSetName, isAdmin }: GetDisplayNameParams): { displayName: string; isBaseSet: boolean } {
  if (isAdmin) {
    return { displayName: cardSetName, isBaseSet: false };
  }

  if (!mainSetName) {
    return { displayName: cardSetName, isBaseSet: false };
  }

  if (cardSetName === mainSetName) {
    return { displayName: "Base Set", isBaseSet: true };
  }

  const delimiter = " - ";
  if (cardSetName.startsWith(mainSetName + delimiter)) {
    const subsetPortion = cardSetName.slice(mainSetName.length + delimiter.length);
    if (subsetPortion.trim()) {
      return { displayName: subsetPortion, isBaseSet: false };
    }
  }

  return { displayName: cardSetName, isBaseSet: false };
}
