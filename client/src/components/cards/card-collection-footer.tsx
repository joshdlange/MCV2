import { useEffect, useState } from "react";
import { CardDetailActions } from "./card-detail-actions";
import { useCardCollectionControls } from "@/hooks/useCardCollectionControls";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { UpgradeModal } from "@/components/subscription/upgrade-modal";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

export function CardCollectionFooter({ cardId, cardName, isOpen }: {
  cardId: number; cardName: string; isOpen: boolean;
}) {
  const { currentUser } = useAppStore();
  const controls = useCardCollectionControls(cardId, isOpen && !!currentUser);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => { setConfirmRemove(false); }, [cardId, isOpen]);
  const quantity = controls.owned?.quantity ?? 0;
  return (
    <>
      {controls.error && (
        <div role="alert" className="px-3 py-2 bg-gray-900 text-sm text-white">
          Could not load your collection controls. <Button size="sm" variant="ghost" onClick={controls.retry}>Retry</Button>
        </div>
      )}
      <CardDetailActions
        owned={!!controls.owned} quantity={quantity}
        busy={controls.busy} wishlistBusy={controls.wishlistBusy}
        inWishlist={!!controls.wished} disabled={!controls.ready}
        onAdd={() => controls.act("add")}
        onRemove={() => setConfirmRemove(true)}
        onDecrease={() => quantity <= 1 ? setConfirmRemove(true) : controls.act("decrease")}
        onIncrease={() => controls.act("increase")}
        onToggleWishlist={controls.toggleWishlist}
      />
      <AlertDialog open={confirmRemove && isOpen} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{quantity > 1 ? `Remove all ${quantity} copies?` : "Remove your last copy?"}</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {cardName} from your collection{quantity > 1 ? `, including all ${quantity} copies` : ""}?
              {" "}This removes this card's collection entry and its saved collection details. It does not delete the catalog card or change your wishlist.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep card</AlertDialogCancel>
            <AlertDialogAction disabled={controls.busy || !controls.owned}
              onClick={() => controls.act("remove")} className="bg-red-600 text-white hover:bg-red-700">
              {quantity > 1 ? "Remove all copies" : "Remove card"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UpgradeModal isOpen={controls.upgradeOpen} onClose={() => controls.setUpgradeOpen(false)}
        currentPlan={currentUser?.plan ?? "SIDE_KICK"} trigger="collection-limit" />
    </>
  );
}
