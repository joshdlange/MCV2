const EBAY_CONFIG = {
  mkrid: import.meta.env.VITE_EBAY_MKRID || '',
  siteid: import.meta.env.VITE_EBAY_SITEID || '',
  campid: import.meta.env.VITE_EBAY_CAMPID || '',
  toolid: import.meta.env.VITE_EBAY_TOOLID || '10001',
  mkevt: import.meta.env.VITE_EBAY_MKEVT || '1',
  mkcid: import.meta.env.VITE_EBAY_MKCID || '1',
  customidPrefix: import.meta.env.VITE_EBAY_CUSTOMID_PREFIX || 'MCV',
};

interface EbayQueryInput {
  cardName: string;
  cardNumber?: string | null;
  subsetName?: string | null;
  mainSetName?: string | null;
  cardId?: number | null;
  setId?: number | null;
  mainSetId?: number | null;
}

function normalizeQuery(parts: string[]): string {
  let query = parts.filter(Boolean).join(' ');
  query = query.replace(/\s+/g, ' ').trim();
  if (query.length > 120) {
    query = query.substring(0, 120).trim();
  }
  return query;
}

function removeDuplicatePrefix(mainSet: string, subset: string): string {
  const mainLower = mainSet.toLowerCase().trim();
  const subLower = subset.toLowerCase().trim();
  if (subLower.startsWith(mainLower)) {
    return subset;
  }
  return `${mainSet} ${subset}`;
}

export function parseSetName(fullComboName: string): { mainSetName: string; subsetName: string | null } {
  const delimiter = ' - ';
  const idx = fullComboName.indexOf(delimiter);
  if (idx > 0) {
    return {
      mainSetName: fullComboName.substring(0, idx).trim(),
      subsetName: fullComboName.substring(idx + delimiter.length).trim() || null,
    };
  }
  return { mainSetName: fullComboName.trim(), subsetName: null };
}

export function buildEbaySearchQuery(input: EbayQueryInput): string {
  const { cardName, cardNumber, subsetName, mainSetName } = input;
  const num = cardNumber ? `#${cardNumber}` : '';
  const hasMainSet = mainSetName && mainSetName.trim() !== '';
  const hasSubset = subsetName && subsetName.trim() !== '' && subsetName.toLowerCase() !== 'base';

  if (hasMainSet && hasSubset) {
    const combined = removeDuplicatePrefix(mainSetName!, subsetName!);
    const q = normalizeQuery([combined, cardName, num]);
    if (q) return q;
  }

  if (hasMainSet) {
    const q = normalizeQuery([mainSetName!, cardName, num]);
    if (q) return q;
  }

  if (hasMainSet) {
    const q = normalizeQuery([mainSetName!, cardName]);
    if (q) return q;
  }

  return normalizeQuery([cardName, num]);
}

export function buildCustomId(input: EbayQueryInput): string {
  const prefix = EBAY_CONFIG.customidPrefix;
  if (input.mainSetId && input.setId && input.cardNumber) {
    return `${prefix}-${input.mainSetId}-${input.setId}-${input.cardNumber}`;
  }
  if (input.cardId) {
    return `${prefix}-${input.cardId}`;
  }
  return prefix;
}

export function buildEbayAffiliateUrl(input: EbayQueryInput): string {
  const query = buildEbaySearchQuery(input);
  const encodedQuery = encodeURIComponent(query);
  let url = `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}`;

  const { campid, mkrid, siteid, mkcid, toolid, mkevt } = EBAY_CONFIG;
  if (campid && mkrid && siteid) {
    url += `&mkcid=${mkcid}`;
    url += `&mkrid=${mkrid}`;
    url += `&siteid=${siteid}`;
    url += `&campid=${campid}`;
    url += `&toolid=${toolid}`;
    url += `&mkevt=${mkevt}`;
    url += `&customid=${encodeURIComponent(buildCustomId(input))}`;
  } else {
    console.warn('[Marvel Card Vault] eBay affiliate env vars not fully configured — link will not be affiliate-tracked');
  }

  return url;
}

export function openEbaySearch(input: EbayQueryInput): void {
  const url = buildEbayAffiliateUrl(input);
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.() && cap.Plugins?.Browser) {
    cap.Plugins.Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function buildInputFromCard(card: { id: number; name: string; cardNumber?: string | null; set?: { id: number; name?: string | null; mainSetId?: number | null } | null }): EbayQueryInput {
  const setFullName = card.set?.name || '';
  const { mainSetName, subsetName } = parseSetName(setFullName);
  return {
    cardName: card.name,
    cardNumber: card.cardNumber,
    mainSetName,
    subsetName,
    cardId: card.id,
    setId: card.set?.id || null,
    mainSetId: card.set?.mainSetId || null,
  };
}
