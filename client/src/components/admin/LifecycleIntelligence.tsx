import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Clock, Rocket, Info, TrendingDown, RefreshCw, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  SUBSCRIPTION_STATUSES,
  matchesSubscriptionFilter,
  SubscriptionStatusBadge,
  SubscriptionTruthUnavailable,
  type SubscriptionCustomerFilter,
  type SubscriptionStatus,
} from "./subscription-truth-presentation";

interface LifecycleOverview {
  stages: Array<{ stage: string; count: number }>;
  rules: Record<string, string>;
  funnel: {
    signedUp: number; onboardingComplete: number; addedFirstCard: number;
    returning: number; engaged: number; upgraded: number; cancelled: number; deleted: number;
  };
  conversion: {
    onboardingRate: number; firstCardRate: number; returningRate: number;
    engagedRate: number; upgradeRate: number; churnRate: number;
  };
}

interface DaysToUpgrade {
  knownUpgrades: number;
  unknownDates: number;
  medianDays: number | null;
  p90Days: number | null;
  buckets: Array<{ label: string; count: number }>;
}

interface Heatmap {
  timezone: string;
  weeks: number;
  grid: number[][]; // [dow 0=Sun][hour]
  byHour: number[];
  quietestWindows: Array<{ startHour: number; endHour: number; actions: number }>;
  busiestWindows: Array<{ startHour: number; endHour: number; actions: number }>;
}

interface SubscriptionTruth {
  summary: {
    paying: number;
    complimentary: number;
    cancellationScheduled: number;
    paymentDeclined: number;
    churnedCanceled: number;
    churnedDeclined: number;
    unknown: number;
  };
  customers: Array<{
    userId: number;
    username: string | null;
    email: string | null;
    provider: "stripe" | "apple" | "complimentary" | "unknown";
    status: SubscriptionStatus;
    reason: string | null;
    changedAt: string | null;
    recoveryEndsAt: string | null;
  }>;
  events: Array<{
    id: string | number;
    userId: number;
    username: string | null;
    type: string;
    reason: string | null;
    occurredAt: string;
    provider: "stripe" | "apple" | "complimentary" | "unknown";
  }>;
}

function formatTruthDate(value: string | null | undefined) {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time not recorded";
  return date.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function SubscriptionTruthPanel() {
  const [statusFilter, setStatusFilter] = useState<SubscriptionCustomerFilter>("all");
  const [search, setSearch] = useState("");
  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<SubscriptionTruth>({
    queryKey: ["/api/admin/subscription-truth"],
    queryFn: () => apiRequest("GET", "/api/admin/subscription-truth").then(r => r.json()),
  });

  const summaryCards: Array<{ status: SubscriptionStatus; value: number }> = data ? [
    { status: "paying", value: data.summary.paying },
    { status: "complimentary", value: data.summary.complimentary },
    { status: "cancellation_scheduled", value: data.summary.cancellationScheduled },
    { status: "payment_declined", value: data.summary.paymentDeclined },
    { status: "churned_canceled", value: data.summary.churnedCanceled },
    { status: "churned_declined", value: data.summary.churnedDeclined },
    { status: "unknown", value: data.summary.unknown },
  ] : [];
  const normalizedSearch = search.trim().toLowerCase();
  const visibleCustomers = (data?.customers ?? []).filter(customer => {
    if (!matchesSubscriptionFilter(customer.status, statusFilter)) return false;
    if (!normalizedSearch) return true;
    return [customer.username, customer.email, customer.provider, customer.reason, String(customer.userId)]
      .some(value => value?.toLowerCase().includes(normalizedSearch));
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Subscription truth</CardTitle>
            <p className="text-xs text-gray-500 font-normal mt-1">
              Current provider-confirmed billing state. Paying, complimentary access, recovery, and terminal churn are separate.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-28 flex items-center justify-center text-gray-400 text-sm">Loading subscription truth…</div>
        ) : isError || !data ? (
          <SubscriptionTruthUnavailable />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {summaryCards.map(({ status, value }) => {
                const definition = SUBSCRIPTION_STATUSES[status];
                const filter: SubscriptionCustomerFilter = status === "paying" ? "paying_including_scheduled" : status;
                return (
                  <button
                    type="button"
                    key={status}
                    onClick={() => setStatusFilter(current => current === filter ? "all" : filter)}
                    className={`text-left rounded-lg border p-2.5 transition-shadow hover:shadow-sm ${definition.className} ${
                      statusFilter === filter ? "ring-2 ring-blue-500 ring-offset-1" : ""
                    }`}
                    title={definition.help}
                  >
                    <p className="text-xl font-bold">{value.toLocaleString()}</p>
                    <p className="text-[11px] font-semibold leading-tight mt-0.5">
                      {status === "paying" ? "Paying (includes scheduled)" : definition.label}
                    </p>
                    {status === "cancellation_scheduled" && (
                      <p className="text-[10px] leading-tight mt-0.5">subset of paying</p>
                    )}
                  </button>
                );
              })}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Recent billing changes</h3>
              {data.events.length === 0 ? (
                <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">No billing changes recorded yet.</p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {data.events.slice(0, 20).map(event => (
                    <div key={event.id} className="p-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {event.username || `User ${event.userId}`}
                          <span className="font-normal text-gray-500"> · {event.type.replaceAll("_", " ")}</span>
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">{event.reason || "No reason supplied by provider"}</p>
                      </div>
                      <div className="text-xs text-gray-500 sm:text-right shrink-0">
                        <p className="capitalize">{event.provider}</p>
                        <time dateTime={event.occurredAt}>{formatTruthDate(event.occurredAt)}</time>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Customers by current billing state</h3>
                  <p className="text-xs text-gray-500">{visibleCustomers.length} of {data.customers.length} customers shown</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <label className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                    <input
                      type="search"
                      value={search}
                      onChange={event => setSearch(event.target.value)}
                      placeholder="Search name, email, reason…"
                      className="h-9 w-full sm:w-64 rounded-md border border-gray-300 bg-white pl-8 pr-3 text-sm"
                    />
                  </label>
                  <select
                    value={statusFilter}
                    onChange={event => setStatusFilter(event.target.value as SubscriptionCustomerFilter)}
                    className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
                    aria-label="Filter customers by billing state"
                  >
                    <option value="all">All billing states</option>
                    <option value="paying_including_scheduled">Paying (includes cancellation scheduled)</option>
                    {Object.entries(SUBSCRIPTION_STATUSES).map(([status, definition]) => (
                      status === "paying" ? null :
                      <option key={status} value={status}>{definition.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="text-left font-medium p-2.5">Customer</th>
                      <th className="text-left font-medium p-2.5">Billing state</th>
                      <th className="text-left font-medium p-2.5">Provider</th>
                      <th className="text-left font-medium p-2.5">Reason</th>
                      <th className="text-left font-medium p-2.5">Changed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {visibleCustomers.map(customer => {
                      return (
                        <tr key={customer.userId}>
                          <td className="p-2.5">
                            <p className="font-medium text-gray-900">{customer.username || `User ${customer.userId}`}</p>
                            <p className="text-xs text-gray-500">{customer.email || `User ID ${customer.userId}`}</p>
                          </td>
                          <td className="p-2.5">
                            <SubscriptionStatusBadge status={customer.status} />
                            {customer.status === "payment_declined" && (
                              <p className="text-[11px] text-gray-500 mt-1">
                                {customer.recoveryEndsAt
                                  ? `Provider recovery ends by ${formatTruthDate(customer.recoveryEndsAt)}`
                                  : "Recovery timing not supplied"}
                              </p>
                            )}
                          </td>
                          <td className="p-2.5 capitalize text-gray-700">{customer.provider}</td>
                          <td className="p-2.5 text-gray-600 max-w-xs">{customer.reason || "No reason supplied"}</td>
                          <td className="p-2.5 text-xs text-gray-600">{formatTruthDate(customer.changedAt)}</td>
                        </tr>
                      );
                    })}
                    {visibleCustomers.length === 0 && (
                      <tr><td colSpan={5} className="p-6 text-center text-gray-500">No customers match these filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                Payment state does not by itself describe feature access. Apple controls its own billing and retry behavior; no retry countdown is promised here.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const STAGE_COLORS: Record<string, string> = {
  "Signed Up": "#9ca3af",
  "Onboarding Complete": "#60a5fa",
  "Empty Vault": "#fbbf24",
  "Collector Started": "#34d399",
  "Returning Collector": "#10b981",
  "Engaged Collector": "#059669",
  "Power Collector": "#8b5cf6",
  "Super Hero": "#22c55e",
  "Cancelled": "#f87171",
  "Dormant": "#6b7280",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtHour(h: number) {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}

export default function LifecycleIntelligence() {
  const [showRules, setShowRules] = useState(false);

  const { data: overview, isLoading: ovLoading } = useQuery<LifecycleOverview>({
    queryKey: ["/api/admin/lifecycle-overview"],
    queryFn: () => apiRequest("GET", "/api/admin/lifecycle-overview").then(r => r.json()),
  });
  const { data: daysToUpgrade, isLoading: dtuLoading } = useQuery<DaysToUpgrade>({
    queryKey: ["/api/admin/days-to-upgrade"],
    queryFn: () => apiRequest("GET", "/api/admin/days-to-upgrade").then(r => r.json()),
  });
  const { data: heatmap, isLoading: hmLoading } = useQuery<Heatmap>({
    queryKey: ["/api/admin/activity-heatmap"],
    queryFn: () => apiRequest("GET", "/api/admin/activity-heatmap?weeks=8").then(r => r.json()),
  });

  const funnelSteps = overview ? [
    { label: "Signed Up", value: overview.funnel.signedUp },
    { label: "Onboarding Complete", value: overview.funnel.onboardingComplete },
    { label: "Added First Card", value: overview.funnel.addedFirstCard },
    { label: "Returning (3+ logins)", value: overview.funnel.returning },
    { label: "Engaged", value: overview.funnel.engaged },
    { label: "Ever upgraded", value: overview.funnel.upgraded },
    { label: "Deleted Accounts", value: overview.funnel.deleted },
  ] : [];

  // Biggest drop-off between consecutive milestones (excludes Cancelled, which isn't a "next step").
  // Milestones are aggregate counts, not strictly nested cohorts, so only pairs where the
  // later count is actually smaller are meaningful drop-offs.
  const dropOffs = funnelSteps.slice(0, 6).slice(1).map((step, i) => {
    const prev = funnelSteps[i];
    return { from: prev.label, to: step.label, lost: prev.value - step.value };
  }).filter(d => d.lost > 0);
  const biggestDrop = dropOffs.length
    ? dropOffs.reduce((max, d) => (d.lost > max.lost ? d : max), dropOffs[0])
    : null;

  const maxGrid = heatmap ? Math.max(1, ...heatmap.grid.flat()) : 1;

  return (
    <>
      <SubscriptionTruthPanel />

      {/* ── Compact conversion funnel ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Acquisition &amp; upgrade milestones</CardTitle>
          <p className="text-xs text-gray-400 font-normal">
            Historical cumulative milestones, not current subscription totals. Each user may appear in
            multiple steps; use Subscription truth above for current paying and churn states.
          </p>
        </CardHeader>
        <CardContent>
          {ovLoading || !overview ? (
            <div className="h-24 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {funnelSteps.map((step, i) => {
                  const isDeleted = step.label === "Deleted Accounts";
                  const base = funnelSteps[0]?.value ?? 0;
                  const stepPct = i > 0 && !isDeleted && base > 0 ? Math.round((step.value / base) * 100) : null;
                  return (
                    <div
                      key={step.label}
                      className={`rounded-lg border px-2.5 py-2 ${
                        isDeleted ? "border-gray-300 bg-gray-100" : "bg-gray-50"
                      }`}
                    >
                      <p className="text-xl font-bold text-gray-900">
                        {step.value.toLocaleString()}
                      </p>
                      <p className="text-[11px] font-medium text-gray-600 leading-tight mt-0.5">{step.label}</p>
                      {stepPct !== null && (
                        <p className="text-[11px] font-semibold text-blue-600 mt-0.5">{stepPct}% of signups</p>
                      )}
                      {isDeleted && (
                        <p className="text-[11px] font-semibold text-gray-500 mt-0.5">completed deletions</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {biggestDrop && biggestDrop.lost > 0 && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <TrendingDown className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800">
                    <span className="font-semibold">Biggest drop-off:</span>{" "}
                    {biggestDrop.from} → {biggestDrop.to} — {biggestDrop.lost.toLocaleString()} fewer
                    users have reached "{biggestDrop.to}" than "{biggestDrop.from}".
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Days to upgrade ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Time to recorded upgrade</CardTitle>
          <p className="text-xs text-gray-400 font-normal">
            Historical time between signup and the legacy upgrade date. This is not a current paying-customer count.
          </p>
        </CardHeader>
        <CardContent>
          {dtuLoading || !daysToUpgrade ? (
            <div className="h-40 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : daysToUpgrade.knownUpgrades === 0 ? (
            <div className="h-24 flex items-center justify-center text-gray-400 text-sm">
              No upgrade dates recorded yet.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                <Badge className="bg-green-100 text-green-800 border-green-300">
                  Median: {daysToUpgrade.medianDays} days
                </Badge>
                <Badge className="bg-blue-100 text-blue-800 border-blue-300">
                  90% upgrade within {daysToUpgrade.p90Days} days
                </Badge>
                <Badge className="bg-gray-100 text-gray-700 border-gray-300">
                  {daysToUpgrade.knownUpgrades} upgraded accounts with known dates
                </Badge>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={daysToUpgrade.buckets} margin={{ left: 0, right: 8 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={(v: any) => [`${v} accounts`, "Recorded upgrade"]} />
                  <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              {daysToUpgrade.unknownDates > 0 && (
                <p className="text-[11px] text-gray-400 mt-2">
                  {daysToUpgrade.unknownDates} upgraded account{daysToUpgrade.unknownDates === 1 ? "" : "s"} excluded
                  because no upgrade date is recorded.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Lifecycle stages ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Users by Lifecycle Stage</CardTitle>
            <button
              className="text-xs text-blue-600 flex items-center gap-1 hover:underline"
              onClick={() => setShowRules(!showRules)}
            >
              <Info className="w-3.5 h-3.5" /> {showRules ? "Hide" : "Show"} definitions
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {ovLoading || !overview ? (
            <div className="h-52 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={overview.stages} margin={{ left: 0, right: 8 }}>
                  <XAxis dataKey="stage" tick={{ fontSize: 10 }} interval={0} angle={-28} textAnchor="end" height={70} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {overview.stages.map(s => (
                      <Cell key={s.stage} fill={STAGE_COLORS[s.stage] || "#9ca3af"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {showRules && (
                <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600 border-t pt-3">
                  {overview.stages.map(s => (
                    <div key={s.stage}>
                      <span className="font-medium" style={{ color: STAGE_COLORS[s.stage] }}>{s.stage}:</span>{" "}
                      {overview.rules[s.stage]}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Activity heatmap + publish windows ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="w-4 h-4" /> Activity by Hour &amp; Day (Central Time, last 8 weeks)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hmLoading || !heatmap ? (
            <div className="h-52 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div className="grid" style={{ gridTemplateColumns: "42px repeat(24, 1fr)" }}>
                    <div />
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="text-[9px] text-gray-400 text-center">
                        {h % 3 === 0 ? fmtHour(h).replace(" ", "") : ""}
                      </div>
                    ))}
                    {heatmap.grid.map((row, d) => (
                      <div key={d} className="contents">
                        <div className="text-[10px] text-gray-500 pr-1 flex items-center justify-end">{DAYS[d]}</div>
                        {row.map((v, h) => {
                          const intensity = v / maxGrid;
                          return (
                            <div
                              key={h}
                              title={`${DAYS[d]} ${fmtHour(h)}: ${v} actions`}
                              className="h-5 m-[1px] rounded-sm"
                              style={{
                                backgroundColor: v === 0 ? "#f3f4f6" : `rgba(59, 130, 246, ${0.15 + intensity * 0.85})`,
                              }}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mt-5">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-green-800 mb-1">
                    <Rocket className="w-4 h-4" /> Safest publish windows (quietest)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {heatmap.quietestWindows.map(w => (
                      <Badge key={w.startHour} className="bg-green-100 text-green-800 border-green-300">
                        {fmtHour(w.startHour)}–{fmtHour(w.endHour)} CT · {w.actions} actions
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <div className="text-sm font-medium text-orange-800 mb-1">Busiest windows (avoid publishing)</div>
                  <div className="flex flex-wrap gap-2">
                    {heatmap.busiestWindows.map(w => (
                      <Badge key={w.startHour} className="bg-orange-100 text-orange-800 border-orange-300">
                        {fmtHour(w.startHour)}–{fmtHour(w.endHour)} CT · {w.actions} actions
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 mt-3">
                Based on timestamped user actions (card adds, scans, XP events, analytics events) over the last {heatmap.weeks} weeks. Window totals sum all days of the week.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
