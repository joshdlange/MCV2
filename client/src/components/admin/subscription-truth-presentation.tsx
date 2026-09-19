import React from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "../ui/badge";

export type SubscriptionStatus =
  | "paying"
  | "complimentary"
  | "cancellation_scheduled"
  | "payment_declined"
  | "churned_canceled"
  | "churned_declined"
  | "unknown";

export type SubscriptionCustomerFilter = SubscriptionStatus | "paying_including_scheduled" | "all";

export function matchesSubscriptionFilter(status: SubscriptionStatus, filter: SubscriptionCustomerFilter) {
  if (filter === "all") return true;
  if (filter === "paying_including_scheduled") {
    return status === "paying" || status === "cancellation_scheduled";
  }
  return status === filter;
}

export const SUBSCRIPTION_STATUSES: Record<SubscriptionStatus, { label: string; help: string; className: string }> = {
  paying: { label: "Paying", help: "Active provider-confirmed billing; this total includes cancellation scheduled", className: "bg-green-100 text-green-800 border-green-300" },
  complimentary: { label: "Complimentary", help: "Access granted without billing", className: "bg-blue-100 text-blue-800 border-blue-300" },
  cancellation_scheduled: { label: "Cancellation scheduled", help: "Access remains until the provider ends the subscription", className: "bg-amber-100 text-amber-800 border-amber-300" },
  payment_declined: { label: "Payment declined — recovering", help: "Provider recovery is in progress; access and payment status are separate", className: "bg-orange-100 text-orange-800 border-orange-300" },
  churned_canceled: { label: "Churned — canceled", help: "Terminal cancellation", className: "bg-red-100 text-red-800 border-red-300" },
  churned_declined: { label: "Churned — payment declined", help: "Terminal decline after recovery ended", className: "bg-red-100 text-red-800 border-red-300" },
  unknown: { label: "Unknown", help: "Billing evidence is insufficient", className: "bg-gray-100 text-gray-700 border-gray-300" },
};

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  const definition = SUBSCRIPTION_STATUSES[status];
  return <Badge variant="outline" className={definition.className}>{definition.label}</Badge>;
}

export function SubscriptionTruthUnavailable() {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">Subscription truth is unavailable.</p>
        <p className="text-xs mt-1">No totals are shown because displaying zero would be misleading. Try refreshing.</p>
      </div>
    </div>
  );
}