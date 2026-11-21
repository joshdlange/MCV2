import { Check, Heart, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CardDetailActionsProps {
  owned: boolean;
  quantity: number;
  busy: boolean;
  wishlistBusy: boolean;
  inWishlist: boolean;
  disabled: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onDecrease: () => void;
  onIncrease: () => void;
  onToggleWishlist: () => void;
}

/** Lives outside the modal's scroll region; the parent owns mutations and confirmation. */
export function CardDetailActions({
  owned,
  quantity,
  busy,
  wishlistBusy,
  inWishlist,
  disabled,
  onAdd,
  onRemove,
  onDecrease,
  onIncrease,
  onToggleWishlist,
}: CardDetailActionsProps) {
  const collectionDisabled = disabled || busy;
  const wishlistDisabled = disabled || wishlistBusy;
  const wishlistLabel = inWishlist ? "Remove from wishlist" : "Add to wishlist";

  return (
    <div
      className="shrink-0 border-t border-gray-700 bg-gray-900 px-3 pt-3 sm:px-4"
      style={{ paddingBottom: "max(0.75rem, var(--safe-area-bottom, 0px))" }}
      data-testid="card-detail-actions"
      aria-busy={busy || wishlistBusy}
    >
      <div className="flex min-w-0 flex-nowrap items-center gap-2">
        {owned ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-12 min-w-0 flex-1 border-gray-600 bg-gray-800 px-2 text-xs text-red-300 hover:border-red-400/50 hover:bg-red-950 hover:text-red-200 sm:text-sm"
              disabled={collectionDisabled}
              aria-busy={busy}
              aria-label="Remove from collection"
              onClick={onRemove}
              data-testid="button-remove-from-collection"
            >
              Remove
            </Button>
            <div
              role="group"
              aria-label="Copies owned"
              aria-busy={busy}
              className="flex h-12 shrink-0 items-center rounded-md border border-gray-600 bg-gray-800"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0 bg-transparent p-0 text-gray-100 hover:bg-gray-700 hover:text-white"
                disabled={collectionDisabled}
                aria-busy={busy}
                aria-label="Decrease copies owned"
                onClick={onDecrease}
                data-testid="button-quantity-decrease"
              >
                <Minus aria-hidden="true" />
              </Button>
              <span
                className="min-w-6 px-0.5 text-center text-sm font-semibold tabular-nums text-gray-100"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                aria-label={`Quantity: ${quantity} ${quantity === 1 ? "copy" : "copies"} owned`}
                data-testid="text-quantity"
              >
                {quantity}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0 bg-transparent p-0 text-gray-100 hover:bg-gray-700 hover:text-white"
                disabled={collectionDisabled}
                aria-busy={busy}
                aria-label="Increase copies owned"
                onClick={onIncrease}
                data-testid="button-quantity-increase"
              >
                <Plus aria-hidden="true" />
              </Button>
            </div>
          </>
        ) : (
          <Button
            type="button"
            className="h-12 min-w-0 flex-1 gap-1.5 bg-green-600 px-2 text-xs text-white hover:bg-green-700 sm:text-sm"
            disabled={collectionDisabled}
            aria-busy={busy}
            onClick={onAdd}
            data-testid="button-add-to-collection"
          >
            <Check aria-hidden="true" />
            Add to Collection
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={`h-12 w-12 shrink-0 p-0 ${
            inWishlist
              ? "border-pink-400/50 bg-pink-950 text-pink-300 hover:bg-pink-900 hover:text-pink-200"
              : "border-gray-600 bg-gray-800 text-gray-300 hover:border-pink-400/50 hover:bg-gray-700 hover:text-pink-300"
          }`}
          disabled={wishlistDisabled}
          aria-busy={wishlistBusy}
          aria-label={wishlistLabel}
          aria-pressed={inWishlist}
          title={wishlistLabel}
          onClick={onToggleWishlist}
          data-testid={inWishlist ? "button-remove-from-wishlist" : "button-add-to-wishlist"}
        >
          <Heart aria-hidden="true" className={inWishlist ? "fill-current" : undefined} />
        </Button>
      </div>
    </div>
  );
}
