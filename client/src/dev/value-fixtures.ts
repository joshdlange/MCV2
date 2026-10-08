import type { ValueCard, CollectionValueResponse } from "../lib/collectionValue";

// UI-only fixtures. Never written to the database or imported by production routes.
function fixtureImage(name: string, color: string) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="252"><rect width="180" height="252" fill="#171d29"/><path d="M0 90L180 0V175L0 252Z" fill="${color}"/><circle cx="94" cy="103" r="42" fill="#171d29"/><path d="M70 94L85 78L92 105L115 76L110 119L87 135Z" fill="#f9df89"/><text x="12" y="207" fill="#f7f3eb" font-size="15" font-family="sans-serif">${name}</text><text x="12" y="230" fill="#f7f3eb" font-size="9" font-family="sans-serif">UI TEST FIXTURE</text></svg>`)}`;
}

export const valueFixtureCards: ValueCard[] = Array.from({ length: 1043 }, (_, i) => {
  const names = ["Wolverine", "Spider-Man", "Storm", "Jean Grey", "Silver Surfer"];
  const name = names[i % names.length];
  const marketValue = i === 0 ? 284.57 : i < 9 ? 192.83 - i * 9.71 : i < 185 ? 89.37 - i * 0.41 : 0.73 + (i % 67) * 0.057;
  const quantity = i % 13 === 0 ? 2 : 1;
  return {
    id: i + 101, collectionItemId: i + 2001, quantity,
    marketValue: Number(marketValue.toFixed(2)), lineTotal: Number((marketValue * quantity).toFixed(2)),
    priceUpdatedAt: "2026-10-07T10:21:00Z", name, cardNumber: String(i + 1), setId: 7,
    isInsert: i % 3 === 0, frontImageUrl: fixtureImage(name, ["#ae2834", "#314f7c", "#536d66"][i % 3]),
    backImageUrl: null, rarity: "Rare", estimatedValue: "9999.00",
    set: { id: 7, name: "Marvel Masterpieces", year: 2024, mainSetId: 1 },
  };
});

export function fixtureValueResponse(params = new URLSearchParams()): CollectionValueResponse {
  const priced = valueFixtureCards;
  let cards = priced.filter(card => params.get("hideUnder5") === "false" || card.marketValue >= 5);
  if (params.get("search")) cards = cards.filter(card => `${card.name} ${card.cardNumber} ${card.set.name}`.toLowerCase().includes(params.get("search")!.toLowerCase()));
  if (params.get("setId")) cards = cards.filter(card => card.setId === Number(params.get("setId")));
  if (params.get("isInsert")) cards = cards.filter(card => card.isInsert === (params.get("isInsert") === "true"));
  if (params.get("favorite") === "true") cards = cards.filter(card => card.id % 2 === 0);
  cards.sort((a, b) => (params.get("order") === "asc" ? 1 : -1) * (a.marketValue - b.marketValue) || a.id - b.id);
  const offset = Number(params.get("offset") ?? 0), limit = Number(params.get("limit") ?? 25);
  return {
    cards: cards.slice(offset, offset + limit), total: cards.length, hasMore: offset + limit < cards.length,
    summary: {
      totalValue: Number(priced.reduce((sum, card) => sum + card.lineTotal, 0).toFixed(2)),
      pricedCards: priced.length, unpricedCards: 37,
      pricedCopies: priced.reduce((sum, card) => sum + card.quantity, 0),
      pricesUpdatedAt: "2026-10-07T10:21:00Z",
    },
  };
}
