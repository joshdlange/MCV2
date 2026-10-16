import type { SoldRow } from "./soldgraph-client";

export interface PricingCard {
  id: number;
  name: string;
  cardNumber: string;
  year: number;
  parent: string;
  subset: string;
  variation: string | null;
  /** Other subsets containing the same card number; used to detect contradictions. */
  siblings: string[];
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const tokens = (s: string) => norm(s).split(" ").filter(Boolean);
const has = (title: string, word: string) => (` ${title} `).includes(` ${word} `);
const ignored = new Set(["base", "insert", "inserts", "refractor", "parallel", "comics"]);
function subsetWords(card: PricingCard, subset = card.subset): string[] {
  const parentWords = new Set(tokens(card.parent));
  return [...new Set(tokens(subset.replace(/\d*\s*\/\s*\d+/g, "")))]
    .filter(w => !ignored.has(w) && !parentWords.has(w) && !/^\d+$/.test(w));
}
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Verified product-family alias, NOT a global manufacturer equivalence.
// Upper Deck's 2020 checklist identifies What If Level 2 (#37–63) as /999:
// https://upperdeck.com/checklist/2020-marvel-masterpieces-checklist
function is2020Masterpieces(card: PricingCard) {
  return card.year === 2020 &&
    /^(?:2020 )?(?:skybox|upper deck) marvel masterpieces$/.test(norm(card.parent));
}
function familyTitle(card: PricingCard, text: string) {
  const title = norm(text);
  return is2020Masterpieces(card)
    ? title.replace(/\b(?:skybox|upper deck) marvel masterpieces\b/g, "marvel masterpieces")
    : title;
}
function expectedSerial(card: PricingCard) {
  const explicit = `${card.subset} ${card.variation || ""}`.match(/\/\s*(\d+)/)?.[1];
  if (explicit) return explicit;
  const subset = norm(card.subset).replace(`${norm(card.parent)} `, "");
  if (is2020Masterpieces(card) && /^what if(?: level 2)?$/.test(subset) &&
      !card.variation && /^\d+$/.test(card.cardNumber) &&
      Number(card.cardNumber) >= 37 && Number(card.cardNumber) <= 63) return "999";
  return undefined;
}

export function buildSoldQueries(card: PricingCard): string[] {
  if (!card.name || !card.cardNumber || !card.parent) throw new Error("Missing card identity metadata");
  const parent = card.parent.replace(/\b\d{4}\b/g, "").replace(/\bComics\b/gi, "").trim();
  const identity = `${card.name} ${card.cardNumber}`;
  const detail = subsetWords(card).join(" ");
  // Keep original card-number punctuation; matching independently tolerates punctuation.
  return [...new Set([
    `${card.year} ${parent} ${identity} ${detail}`,
    `${card.year} ${parent} ${identity}`,
    `${identity} ${parent}`,
  ].map(q => q.replace(/\s+/g, " ").trim()))];
}

export function rejectionReason(card: PricingCard, row: SoldRow): string | null {
  const original = row.title || "";
  const title = familyTitle(card, original);
  if (!tokens(card.name).every(w => has(title, w))) return "character_mismatch";
  const numberParts = card.cardNumber.match(/[a-zA-Z]+|\d+/g) || [];
  const numberPattern = new RegExp(`(?:^|[^a-z0-9])#?${numberParts.map(escaped).join("[\\s-]*")}(?![a-z0-9])`, "i");
  if (!numberParts.length || !numberPattern.test(original)) return "card_number_mismatch";
  if (/\b(psa|bgs|cgc|sgc|beckett|graded|slab|grade|gem mint)\b/.test(title) ||
      /\bgraded\b/i.test(row.condition || "")) return "graded";
  if (/\b(lot|bundle|playset|pick|choose|complete set|you pick)\b/.test(title) ||
      /\b\d+\s*(?:card lot|cards|pcs|count)\b/.test(title)) return "lot_or_multi_card";
  const years = original.match(/\b(?:19|20)\d{2}\b/g) || [];
  if (years.some(y => Number(y) !== card.year)) return "wrong_year";
  const parentWords = tokens(familyTitle(card, card.parent)).filter(w => !/^\d+$/.test(w) && w !== "comics");
  if (!parentWords.every(w => has(title, w))) return "insufficient_set_evidence";

  const expected = subsetWords(card, `${card.subset} ${card.variation || ""}`);
  const serial = expectedSerial(card);
  const observedSerials = [...original.matchAll(/\/\s*(\d+)\b/g)].map(m => m[1]);
  if (observedSerials.some(n => n !== serial)) return "wrong_serial_parallel";
  // Sibling metadata provides generic parallel contradiction evidence, not a Knull rule.
  for (const sibling of card.siblings) {
    const distinguishing = subsetWords(card, sibling).filter(w => !expected.includes(w));
    if (distinguishing.length && distinguishing.every(w => has(title, w))) return "contradictory_parallel";
  }
  const knownVariants = ["refractor", "x fractor", "xfractor", "raywave", "speckle", "shimmer", "superfractor", "printing plate", "gold", "green", "blue", "red", "purple", "orange", "pink", "black", "sapphire", "mini diamond"];
  const target = norm(`${card.subset} ${card.variation || ""}`);
  if (knownVariants.some(w => has(title, w) && !has(target, w) &&
      !(w === "refractor" && expected.length > 0))) {
    // Refractor is optional generic wording on other refractor variants, but not on a base card.
    return "contradictory_parallel";
  }
  const explicitVariant = expected.every(w => has(title, w));
  const serialMatch = !!serial && observedSerials.includes(serial);
  // Inferred checklist numbering never substitutes for explicit subset evidence.
  if (is2020Masterpieces(card) && serial === "999" &&
      !`${card.subset} ${card.variation || ""}`.includes("/999") && !explicitVariant)
    return "insufficient_parallel_evidence";
  if (!explicitVariant && !serialMatch) return "insufficient_parallel_evidence";
  if (serial && !serialMatch && !expected.length) return "missing_serial_evidence";
  return null;
}

export function analyzeSoldRows(card: PricingCard, rows: SoldRow[]) {
  const seen = new Set<string>();
  const decisions = rows.map(row => {
    let rejection = seen.has(row.id) ? "duplicate_listing" : rejectionReason(card, row);
    seen.add(row.id);
    let exclusion: string | null = null;
    if (!rejection) {
      if (row.best_offer_accepted === true) exclusion = "best_offer";
      else if (row.best_offer_accepted !== false) exclusion = "unknown_best_offer_status";
      else if (row.displayed_price_range) exclusion = "price_range";
      else if (!row.displayed_price || typeof row.displayed_price.amount !== "number" ||
               !Number.isFinite(row.displayed_price.amount) || row.displayed_price.amount <= 0) exclusion = "invalid_price";
      else if (row.displayed_price.currency !== "USD") exclusion = "non_usd";
      else if (!row.sold_date || !/^\d{4}-\d{2}-\d{2}$/.test(row.sold_date) ||
               !Number.isFinite(Date.parse(row.sold_date))) exclusion = "missing_sold_date";
    }
    // Deliberately omit seller identities and images from diagnostics.
    return {
      id: row.id, title: row.title, link: row.link, soldDate: row.sold_date,
      displayedPrice: row.displayed_price, shipping: row.displayed_shipping,
      shippingText: row.shipping_text, bestOfferAccepted: row.best_offer_accepted,
      rejection, exclusion, usable: !rejection && !exclusion,
    };
  });
  const usable = decisions.filter(d => d.usable);
  const prices = usable.map(d => d.displayedPrice!.amount).sort((a, b) => a - b);
  const dates = usable.map(d => d.soldDate!).sort();
  const mid = Math.floor(prices.length / 2);
  return {
    upstreamCount: rows.length,
    acceptedCount: decisions.filter(d => !d.rejection).length,
    rejectedCount: decisions.filter(d => d.rejection).length,
    bestOfferCount: decisions.filter(d => d.exclusion === "best_offer").length,
    upstreamBestOfferCount: rows.filter(r => r.best_offer_accepted === true).length,
    usableCount: usable.length,
    median: prices.length ? Math.round((prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2) * 100) / 100 : null,
    low: prices[0] ?? null, high: prices.at(-1) ?? null,
    earliestSoldDate: dates[0] ?? null, latestSoldDate: dates.at(-1) ?? null,
    decisions,
  };
}
