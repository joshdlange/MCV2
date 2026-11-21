export type CollectionAction = "add" | "increase" | "decrease" | "remove";
export interface OwnedCard {
  id: number;
  cardId: number;
  quantity: number;
}

export function collectionActionRequest(action: CollectionAction, cardId: number, owned?: OwnedCard) {
  if (action === "add") {
    return { method: "POST", url: "/api/collection", body: {
      cardId, condition: "Near Mint", quantity: 1, incrementExisting: false,
    } };
  }
  if (!owned || owned.cardId !== cardId) throw new Error("Refresh this card's collection status and try again.");
  if (action === "remove") return { method: "DELETE", url: `/api/collection/${owned.id}`, body: undefined };
  const quantity = owned.quantity + (action === "increase" ? 1 : -1);
  if (quantity < 1) throw new Error("Confirm removal of the last copy.");
  if (quantity > 9999) throw new Error("You can track up to 9,999 copies of a card.");
  return { method: "PATCH", url: `/api/collection/${owned.id}`, body: { quantity } };
}
