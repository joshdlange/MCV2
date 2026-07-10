import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Users, CreditCard, TrendingUp, Eye, MousePointer, X, ChevronRight, ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, Apple } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface FunnelStats {
  signups: number;
  addedCard: number;
  returningUsers: number;
  upgraded: number;
  cancelled: number;
}

interface ModalStats {
  shown: number;
  clicked: number;
  dismissed: number;
  conversionRate: number;
  byPlatform: Array<{ platform: string; event_type: string; count: string }>;
  byTrigger: Array<{ trigger: string; count: string }>;
}

interface SignupDay {
  date: string;
  count: number;
}

interface RcAuditUser {
  userId: number;
  email: string;
  username: string;
  currentPlan: string;
  rcProduct: string;
  purchaseDate: string;
  expiresDate: string;
  fixed: boolean;
}

interface RcAuditResult {
  scanned: number;
  affected: number;
  errors: number;
  autoFixed: boolean;
  users: RcAuditUser[];
}

const FUNNEL_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pct(num: number, denom: number) {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function formatDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - i);

export default function AdminAnalytics() {
  const { toast } = useToast();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  const [rcResults, setRcResults] = useState<RcAuditResult | null>(null);
  const [rcRunning, setRcRunning] = useState(false);

  const runRcAudit = async (fix: boolean) => {
    setRcRunning(true);
    try {
      const res = await apiRequest("GET", `/api/admin/rc-audit?fix=${fix}`);
      const data: RcAuditResult = await res.json();
      setRcResults(data);
      if (fix && data.affected > 0) {
        toast({ title: `✅ Fixed ${data.affected} users`, description: "They've been upgraded to SUPER_HERO." });
      } else if (!fix && data.affected > 0) {
        toast({ title: `⚠️ ${data.affected} paid users not upgraded`, description: "Click 'Fix All' to upgrade them.", variant: "destructive" });
      } else if (data.errors > 0) {
        toast({ title: "Scan incomplete", description: `${data.errors} RC lookups failed — results may be incomplete. Check server logs.`, variant: "destructive" });
      } else {
        toast({ title: "All clear!", description: `Scanned ${data.scanned} users — everyone who paid is upgraded.` });
      }
    } catch {
      toast({ title: "Audit failed", description: "Check server logs.", variant: "destructive" });
    } finally {
      setRcRunning(false);
    }
  };

  const { data: funnel, isLoading: funnelLoading } = useQuery<FunnelStats>({
    queryKey: ["/api/admin/funnel-stats"],
  });

  const { data: modal, isLoading: modalLoading } = useQuery<ModalStats>({
    queryKey: ["/api/admin/upgrade-modal-stats"],
  });

  const { data: signups = [], isLoading: signupsLoading } = useQuery<SignupDay[]>({
    queryKey: [`/api/admin/signup-stats?year=${selectedYear}&month=${selectedMonth}`],
  });

  const totalSignupsThisMonth = signups.reduce((s, d) => s + d.count, 0);
  const peakDay = signups.reduce((max, d) => (d.count > max.count ? d : max), { date: "", count: 0 });

  const chartData = signups.map((d) => ({ ...d, label: formatDay(d.date) }));

  const funnelSteps = funnel
    ? [
        { label: "Signed Up", value: funnel.signups, icon: Users, desc: "Total registered accounts" },
        { label: "Added a Card", value: funnel.addedCard, icon: TrendingUp, desc: "Added at least one card" },
        { label: "Returning (3+ logins)", value: funnel.returningUsers, icon: Users, desc: "Logged in 3+ times" },
        { label: "Upgraded", value: funnel.upgraded, icon: CreditCard, desc: "Active Super Hero subscribers" },
        { label: "Cancelled", value: funnel.cancelled, icon: X, desc: "Were Super Hero, now cancelled" },
      ]
    : [];

  const funnelChartData = funnelSteps.map((s) => ({ name: s.label, value: s.value }));

  const platformMap: Record<string, { shown: number; clicked: number }> = {};
  modal?.byPlatform?.forEach((row) => {
    const p = row.platform || "unknown";
    if (!platformMap[p]) platformMap[p] = { shown: 0, clicked: 0 };
    if (row.event_type === "upgrade_modal_shown") platformMap[p].shown += parseInt(row.count as any) || 0;
    if (row.event_type === "upgrade_clicked") platformMap[p].clicked += parseInt(row.count as any) || 0;
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-10">

      {/* ── Daily Signups ───────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Daily Signups</h1>
            <p className="text-sm text-gray-500 mt-0.5">New registrations by day — use to correlate with marketing</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
              <SelectTrigger className="w-36 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-24 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary pills */}
        <div className="flex gap-4 mb-4 mt-3">
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2 flex items-center gap-3">
            <span className="text-xl font-bold text-blue-700">{totalSignupsThisMonth}</span>
            <span className="text-sm text-blue-600">signups this month</span>
          </div>
          {peakDay.date && (
            <div className="bg-purple-50 border border-purple-100 rounded-lg px-4 py-2 flex items-center gap-3">
              <span className="text-xl font-bold text-purple-700">{peakDay.count}</span>
              <span className="text-sm text-purple-600">peak day ({formatDay(peakDay.date)})</span>
            </div>
          )}
        </div>

        <Card>
          <CardContent className="pt-4 pb-2">
            {signupsLoading ? (
              <div className="h-52 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
            ) : chartData.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-gray-400 text-sm">No signups recorded for this month yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="signupGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                    interval={chartData.length > 20 ? 2 : 0}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    formatter={(v: number) => [v, "Signups"]}
                    labelFormatter={(label) => `Date: ${label}`}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#signupGrad)"
                    dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Conversion Funnel ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Conversion Funnel</h2>
        <p className="text-sm text-gray-500 mt-0.5">All-time: how users move from signup to Super Hero</p>
      </div>

      {funnelLoading ? (
        <div className="text-center py-12 text-gray-400">Loading funnel data…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {funnelSteps.map((step, i) => (
              <Card key={step.label} className="border">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: FUNNEL_COLORS[i] }}
                    >
                      {i + 1}
                    </div>
                    <step.icon className="w-4 h-4 text-gray-400" />
                  </div>
                  <p className="text-2xl font-bold text-gray-900 mt-2">{step.value.toLocaleString()}</p>
                  <p className="text-xs font-semibold text-gray-700 mt-0.5 leading-tight">{step.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-tight">{step.desc}</p>
                  {i > 0 && (
                    <p className="text-xs font-medium mt-1.5" style={{ color: FUNNEL_COLORS[i] }}>
                      {pct(step.value, funnelSteps[i - 1].value)} of prev step
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funnel Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={funnelChartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <XAxis type="number" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="name" type="category" width={170} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number) => v.toLocaleString()} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {funnelChartData.map((_, i) => (
                      <Cell key={i} fill={FUNNEL_COLORS[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Card Activation Rate", value: pct(funnel!.addedCard, funnel!.signups), sub: "Signups who added a card", color: "text-blue-600" },
              { label: "Retention Rate", value: pct(funnel!.returningUsers, funnel!.addedCard), sub: "Card adders with 3+ logins", color: "text-purple-600" },
              { label: "Upgrade Rate", value: pct(funnel!.upgraded, funnel!.returningUsers), sub: "Returning users who paid", color: "text-green-600" },
              {
                label: "Churn Rate",
                value: funnel!.upgraded > 0 ? pct(funnel!.cancelled, funnel!.upgraded + funnel!.cancelled) : "—",
                sub: "Of ever-paid users",
                color: "text-red-600",
              },
            ].map((m) => (
              <Card key={m.label}>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
                  <p className="text-xs font-semibold text-gray-700 mt-1">{m.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{m.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* ── iOS Subscription Health ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Apple className="w-5 h-5 text-gray-700" /> iOS Subscription Health
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Cross-checks every account against RevenueCat to catch paid users stuck on SIDE_KICK
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-blue-200 text-blue-700 hover:bg-blue-50 bg-white"
            onClick={() => runRcAudit(false)}
            disabled={rcRunning}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${rcRunning ? "animate-spin" : ""}`} />
            {rcRunning ? "Scanning…" : "Run Audit"}
          </Button>
        </div>
      </div>

      {rcResults ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <Users className="w-5 h-5 text-gray-400 mb-1" />
                <p className="text-2xl font-bold text-gray-900">{rcResults.scanned.toLocaleString()}</p>
                <p className="text-xs font-semibold text-gray-700 mt-1">Accounts Scanned</p>
                <p className="text-xs text-gray-400 mt-0.5">Non-Super Hero users checked vs RevenueCat</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                {rcResults.affected > 0 ? (
                  <AlertTriangle className="w-5 h-5 text-amber-500 mb-1" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-green-500 mb-1" />
                )}
                <p className={`text-2xl font-bold ${rcResults.affected > 0 ? "text-amber-600" : "text-green-600"}`}>
                  {rcResults.affected.toLocaleString()}
                </p>
                <p className="text-xs font-semibold text-gray-700 mt-1">Paid but Not Upgraded</p>
                <p className="text-xs text-gray-400 mt-0.5">Active iOS entitlement, wrong plan</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <ShieldCheck className="w-5 h-5 text-green-500 mb-1" />
                <p className="text-2xl font-bold text-green-600">
                  {rcResults.users.filter((u) => u.fixed).length.toLocaleString()}
                </p>
                <p className="text-xs font-semibold text-gray-700 mt-1">Fixed This Run</p>
                <p className="text-xs text-gray-400 mt-0.5">Auto-upgraded to Super Hero</p>
              </CardContent>
            </Card>
          </div>

          {rcResults.errors > 0 && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
              <p className="text-sm text-red-800">
                {rcResults.errors} RevenueCat {rcResults.errors === 1 ? "lookup" : "lookups"} failed during this scan —
                results may be incomplete. Check server logs and re-run.
              </p>
            </div>
          )}

          {rcResults.affected > 0 && !rcResults.autoFixed && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <p className="text-sm text-amber-800 flex-1">
                {rcResults.affected} {rcResults.affected === 1 ? "user has" : "users have"} paid on iOS but{" "}
                {rcResults.affected === 1 ? "is" : "are"} still on SIDE_KICK.
              </p>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => runRcAudit(true)}
                disabled={rcRunning}
              >
                <ShieldCheck className="h-4 w-4 mr-1.5" />
                Fix All ({rcResults.affected})
              </Button>
            </div>
          )}

          {rcResults.users.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Affected Accounts</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">User</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">RC Product</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Expires</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rcResults.users.map((u) => (
                        <tr key={u.userId} className="border-t border-gray-100">
                          <td className="px-4 py-2">
                            <p className="font-medium text-gray-900">{u.username}</p>
                            <p className="text-gray-400 text-xs">{u.email}</p>
                          </td>
                          <td className="px-4 py-2 text-gray-600 font-mono text-xs">{u.rcProduct}</td>
                          <td className="px-4 py-2 text-gray-600 text-xs">
                            {new Date(u.expiresDate).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-2">
                            {u.fixed ? (
                              <Badge className="bg-green-100 text-green-700 text-xs">Fixed ✓</Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-700 text-xs flex items-center gap-1 w-fit">
                                <AlertTriangle className="h-2.5 w-2.5" /> Needs fix
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <Apple className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Run the audit to check for iOS subscribers who paid but weren't upgraded.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Upgrade Modal Stats ────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Upgrade Modal Performance</h2>
        <p className="text-sm text-gray-500 mt-0.5">Tracking since deployment — data builds over time</p>
      </div>

      {modalLoading ? (
        <div className="text-center py-8 text-gray-400">Loading modal data…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Times Shown", value: modal!.shown, icon: Eye, color: "text-blue-600" },
              { label: "Upgrade Tapped", value: modal!.clicked, icon: MousePointer, color: "text-green-600" },
              { label: "Dismissed", value: modal!.dismissed, icon: X, color: "text-gray-500" },
              { label: "Tap-Through Rate", value: `${modal!.conversionRate}%`, icon: ChevronRight, color: "text-purple-600" },
            ].map((m) => (
              <Card key={m.label}>
                <CardContent className="pt-4 pb-3 px-4">
                  <m.icon className={`w-5 h-5 ${m.color} mb-1`} />
                  <p className={`text-2xl font-bold ${m.color}`}>
                    {typeof m.value === "number" ? m.value.toLocaleString() : m.value}
                  </p>
                  <p className="text-xs font-semibold text-gray-700 mt-1">{m.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">By Platform</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(platformMap).length === 0 ? (
                  <p className="text-xs text-gray-400">No data yet</p>
                ) : (
                  Object.entries(platformMap).map(([platform, counts]) => (
                    <div key={platform} className="flex items-center justify-between text-sm">
                      <span className="capitalize font-medium text-gray-700">{platform}</span>
                      <div className="flex gap-4 text-xs text-gray-500">
                        <span>{counts.shown.toLocaleString()} shown</span>
                        <span className="text-green-600 font-medium">{counts.clicked.toLocaleString()} tapped</span>
                        <span className="text-purple-600 font-medium">{pct(counts.clicked, counts.shown)} CTR</span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Modal Triggers</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {!modal?.byTrigger?.length ? (
                  <p className="text-xs text-gray-400">No data yet</p>
                ) : (
                  modal.byTrigger.map((row) => (
                    <div key={row.trigger} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 capitalize">{(row.trigger || "unknown").replace(/_/g, " ")}</span>
                      <span className="font-semibold text-gray-900">{parseInt(row.count as any).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
