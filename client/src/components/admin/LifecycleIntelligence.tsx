import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Clock, Rocket, Info } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface LifecycleOverview {
  stages: Array<{ stage: string; count: number }>;
  rules: Record<string, string>;
  funnel: {
    signedUp: number; onboardingComplete: number; addedFirstCard: number;
    returning: number; engaged: number; upgraded: number; cancelled: number;
  };
  conversion: {
    onboardingRate: number; firstCardRate: number; returningRate: number;
    engagedRate: number; upgradeRate: number; churnRate: number;
  };
}

interface Heatmap {
  timezone: string;
  weeks: number;
  grid: number[][]; // [dow 0=Sun][hour]
  byHour: number[];
  quietestWindows: Array<{ startHour: number; endHour: number; actions: number }>;
  busiestWindows: Array<{ startHour: number; endHour: number; actions: number }>;
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
    { label: "Upgraded (paying)", value: overview.funnel.upgraded },
    { label: "Cancelled", value: overview.funnel.cancelled },
  ] : [];

  const maxGrid = heatmap ? Math.max(1, ...heatmap.grid.flat()) : 1;

  return (
    <>
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

      {/* ── Conversion journey ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Conversion Journey</CardTitle>
          <p className="text-xs text-gray-400 font-normal">
            Cumulative: each bar counts every user who has ever reached that milestone, so one user
            appears in multiple bars. This differs from Lifecycle Stages above, where each user
            counts in exactly one (their highest) stage.
          </p>
        </CardHeader>
        <CardContent>
          {ovLoading || !overview ? (
            <div className="h-40 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <>
              <div className="space-y-2">
                {funnelSteps.map((step, i) => {
                  const base = funnelSteps[0].value || 1;
                  const width = Math.max(2, Math.round((step.value / base) * 100));
                  const isCancelled = step.label === "Cancelled";
                  return (
                    <div key={step.label} className="flex items-center gap-3">
                      <div className="w-44 text-xs text-gray-600 text-right shrink-0">{step.label}</div>
                      <div className="flex-1">
                        <div
                          className={`h-6 rounded flex items-center px-2 text-xs font-medium text-white ${isCancelled ? "bg-red-400" : "bg-blue-500"}`}
                          style={{ width: `${width}%`, opacity: isCancelled ? 0.9 : 1 - i * 0.08 }}
                        >
                          {step.value}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-5">
                {[
                  ["Onboarding", overview.conversion.onboardingRate],
                  ["First Card", overview.conversion.firstCardRate],
                  ["Returning", overview.conversion.returningRate],
                  ["Engaged", overview.conversion.engagedRate],
                  ["Upgrade", overview.conversion.upgradeRate],
                  ["Churn", overview.conversion.churnRate],
                ].map(([label, rate]) => (
                  <div key={label as string} className="bg-gray-50 border rounded-lg px-3 py-2 text-center">
                    <div className="text-lg font-semibold text-gray-800">{rate}%</div>
                    <div className="text-[11px] text-gray-500">{label} rate</div>
                  </div>
                ))}
              </div>
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
