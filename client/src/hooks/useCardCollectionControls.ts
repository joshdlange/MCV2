import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { collectionActionRequest, type CollectionAction, type OwnedCard } from "@/lib/cardCollectionActions";

interface CollectionRow extends OwnedCard { card?: { id: number }; }
interface WishlistRow { id: number; cardId: number; card?: { id: number }; }

export function useCardCollectionControls(cardId: number | undefined, enabled: boolean) {
  const client = useQueryClient();
  const { toast } = useToast();
  const lock = useRef(false);
  const wishLock = useRef(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const collection = useQuery<CollectionRow[]>({ queryKey: ["/api/collection"], enabled });
  const wishlist = useQuery<WishlistRow[]>({ queryKey: ["/api/wishlist"], enabled });
  const owned = collection.data?.find(row => (row.cardId ?? row.card?.id) === cardId);
  const wished = wishlist.data?.find(row => (row.cardId ?? row.card?.id) === cardId);
  const refresh = async () => {
    await Promise.all([
      ...["/api/collection", "/api/stats", "/api/recent-cards", "/api/pc-binders", "/api/collection/value"]
        .map(key => client.invalidateQueries({ queryKey: [key] })),
      client.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith("/api/missing-cards/") }),
    ]);
  };
  const mutation = useMutation({
    mutationFn: async ({ action, id, item }: { action: CollectionAction; id: number; item?: CollectionRow }) => {
      const request = collectionActionRequest(action, id, item);
      const response = await apiRequest(request.method, request.url, request.body);
      return response.json();
    },
    onSuccess: async (saved, variables) => {
      await client.cancelQueries({ queryKey: ["/api/collection"], exact: true });
      client.setQueryData<CollectionRow[]>(["/api/collection"], old => {
        const rows = old ?? [];
        if (variables.action === "remove") return rows.filter(row => row.id !== variables.item?.id);
        const existing = rows.find(row => row.id === saved.id);
        return existing
          ? rows.map(row => row.id === saved.id ? { ...row, ...saved } : row)
          : rows; // New rows need the hydrated card supplied by the collection GET.
      });
      toast({ title: variables.action === "remove" ? "Removed from collection"
        : variables.action === "add" ? "Added to collection" : "Copies updated" });
      await refresh();
    },
    onError: (error: Error) => {
      if (error.message.includes("COLLECTION_LIMIT_REACHED")) setUpgradeOpen(true);
      else toast({ title: "Could not update collection", description: error.message, variant: "destructive" });
    },
    onSettled: () => { lock.current = false; },
  });
  const wishMutation = useMutation({
    mutationFn: async ({ id, item }: { id: number; item?: WishlistRow }) => {
      const response = item
        ? await apiRequest("DELETE", `/api/wishlist/${item.id}`)
        : await apiRequest("POST", "/api/wishlist", { cardId: id, priority: 1 });
      return response.json();
    },
    onSuccess: async (saved, variables) => {
      await client.cancelQueries({ queryKey: ["/api/wishlist"], exact: true });
      client.setQueryData<WishlistRow[]>(["/api/wishlist"], old => variables.item
        ? (old ?? []).filter(row => row.id !== variables.item!.id)
        : old); // Refetch supplies the hydrated card for a newly wished-for item.
      toast({ title: variables.item ? "Removed from wishlist" : "Added to wishlist" });
      await Promise.all(["/api/wishlist", "/api/stats"].map(key => client.invalidateQueries({ queryKey: [key] })));
    },
    onError: (error: Error) => toast({ title: "Could not update wishlist", description: error.message, variant: "destructive" }),
    onSettled: () => { wishLock.current = false; },
  });
  return {
    owned, wished,
    ready: enabled && collection.isSuccess && wishlist.isSuccess,
    error: collection.isError || wishlist.isError,
    retry: () => { void collection.refetch(); void wishlist.refetch(); },
    busy: mutation.isPending,
    wishlistBusy: wishMutation.isPending,
    upgradeOpen, setUpgradeOpen,
    act: (action: CollectionAction) => {
      if (!enabled || !cardId || !collection.isSuccess || lock.current) return;
      lock.current = true;
      mutation.mutate({ action, id: cardId, item: owned });
    },
    toggleWishlist: () => {
      if (!enabled || !cardId || !wishlist.isSuccess || wishLock.current) return;
      wishLock.current = true;
      wishMutation.mutate({ id: cardId, item: wished });
    },
  };
}
