import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface SubscriptionStatus {
  plan: string;
  subscriptionStatus: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export function useSubscription() {
  const queryClient = useQueryClient();

  const { data: subscription, isLoading, error } = useQuery<SubscriptionStatus>({
    queryKey: ["/api/subscription-status"],
    retry: false,
  });

  const createCheckoutSession = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/create-checkout-session");
      return response.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
  });

  const isPremium = subscription?.plan === "SUPER_HERO" && subscription?.subscriptionStatus === "active";
  const isFreePlan = subscription?.plan === "SIDE_KICK" || !subscription?.plan;

  return {
    subscription,
    isLoading,
    error,
    isPremium,
    isFreePlan,
    createCheckoutSession: createCheckoutSession.mutate,
    isCreatingSession: createCheckoutSession.isPending,
  };
}