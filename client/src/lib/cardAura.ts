// Card Aura Tier System
// Maps card value to visual tiers for the Card Details screen aura effect

export type AuraTier = 'common' | 'uncommon' | 'rare' | 'grail';

// Price thresholds (in USD) - can be tuned later
export const AURA_PRICE_THRESHOLDS = {
  uncommon: 5,    // $5+ → uncommon
  rare: 25,       // $25+ → rare  
  grail: 100,     // $100+ → grail
} as const;

/**
 * Get the aura tier based on card price
 */
export function getAuraTierFromPrice(estimatedValue: number | null | undefined): AuraTier {
  const value = estimatedValue ?? 0;
  
  if (value >= AURA_PRICE_THRESHOLDS.grail) return 'grail';
  if (value >= AURA_PRICE_THRESHOLDS.rare) return 'rare';
  if (value >= AURA_PRICE_THRESHOLDS.uncommon) return 'uncommon';
  return 'common';
}

/**
 * Get the aura tier for a card, respecting manual override if present
 */
export function getCardAuraTier(
  estimatedValue: number | null | undefined,
  auraTierOverride?: AuraTier | null
): AuraTier {
  // Manual override takes priority
  if (auraTierOverride && ['common', 'uncommon', 'rare', 'grail'].includes(auraTierOverride)) {
    return auraTierOverride;
  }
  return getAuraTierFromPrice(estimatedValue);
}

// TODO: In the future, consider a quick glow pulse when a card is added,
// triggered from the binder flow. For now, aura effects live only on CardDetails.
