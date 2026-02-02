interface GetDisplayNameParams {
  cardSetName: string;
  mainSetName?: string | null;
  isAdmin: boolean;
}

export function isBaseSetName(cardSetName: string, mainSetName: string): boolean {
  // Base set if name equals main set name
  if (cardSetName === mainSetName) return true;
  // Base set if name is "MainSet - MainSet"
  if (cardSetName === `${mainSetName} - ${mainSetName}`) return true;
  
  const delimiter = " - ";
  if (cardSetName.startsWith(mainSetName + delimiter)) {
    const subsetPortion = cardSetName.slice(mainSetName.length + delimiter.length).toLowerCase().trim();
    // Base set if subset portion is "base" or "base set"
    if (subsetPortion === 'base' || subsetPortion === 'base set') return true;
  }
  return false;
}

export function getCardSetDisplayName({ cardSetName, mainSetName, isAdmin }: GetDisplayNameParams): { displayName: string; isBaseSet: boolean } {
  if (isAdmin) {
    return { displayName: cardSetName, isBaseSet: false };
  }

  if (!mainSetName) {
    return { displayName: cardSetName, isBaseSet: false };
  }

  // Check if this is a base set using unified logic
  if (isBaseSetName(cardSetName, mainSetName)) {
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
