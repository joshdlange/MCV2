import React, { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users, FolderOpen, Edit, PlusCircle, Settings, Calendar, Image, ArrowLeftRight,
  Copy, TrendingUp, Layers, CreditCard, ImageOff, BarChart2, Mail, Plug, Database,
  Archive, AlertTriangle, ChevronDown, ChevronUp, LucideIcon
} from "lucide-react";

interface SubscriberBreakdown {
  totalUsers: number;
  freeUsers: number;
  superHeroMembers: number;
  payingStripe: number;
  payingApple: number;
  payingTotal: number;
  comped: number;
  unknown: number;
  systemAccounts: number;
  rcCheckOk: boolean;
}

interface AdminStats {
  totalUsers: number;
  monthlyActiveUsers: number;
  mauPercent: number;
  paidUsers: number;
  totalSets: number;
  totalCards: number;
  cardsWithoutImages: number;
  breakdown?: SubscriberBreakdown;
}

interface SubscriptionTruthSummary {
  paying: number;
  complimentary: number;
  cancellationScheduled: number;
  paymentDeclined: number;
  churnedCanceled: number;
  churnedDeclined: number;
  unknown: number;
}

interface SubscriptionTruthResponse {
  summary: SubscriptionTruthSummary;
}

type ToolStatus = "active" | "legacy" | "advanced" | "dangerous" | "needs_review" | "coming_soon";

interface AdminTool {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  color: string;
  status?: ToolStatus[];
  warning?: string;
}

interface AdminSection {
  title: string;
  blurb: string;
  icon: LucideIcon;
  tools: AdminTool[];
}

const STATUS_BADGES: Record<ToolStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-100 text-green-700 border-green-200" },
  legacy: { label: "Legacy", className: "bg-gray-100 text-gray-600 border-gray-200" },
  advanced: { label: "Advanced", className: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  dangerous: { label: "Dangerous", className: "bg-red-100 text-red-700 border-red-200" },
  needs_review: { label: "Needs Review", className: "bg-amber-100 text-amber-700 border-amber-200" },
  coming_soon: { label: "Coming Soon", className: "bg-blue-100 text-blue-700 border-blue-200" },
};

const ADMIN_SECTIONS: AdminSection[] = [
  {
    title: "Users",
    blurb: "Accounts, plans, permissions, and subscriber analytics",
    icon: Users,
    tools: [
      {
        title: "Manage Users",
        description: "Look up users, edit plans and admin roles, grant lifetime Super Hero, troubleshoot accounts",
        href: "/admin/users",
        icon: Users,
        color: "bg-blue-500",
        status: ["active"],
      },
      {
        title: "Subscription Truth & Conversion",
        description: "Current provider-confirmed billing states, recent changes, customer lookup, and acquisition milestones",
        href: "/admin/analytics",
        icon: BarChart2,
        color: "bg-yellow-500",
        status: ["active"],
      },
    ],
  },
  {
    title: "Cards & Sets",
    blurb: "The card database: sets, subsets, imports, and releases",
    icon: Layers,
    tools: [
      {
        title: "Add Cards",
        description: "Single card entry, set creation, CSV upload, and bulk import into the card database",
        href: "/admin/cards",
        icon: PlusCircle,
        color: "bg-purple-500",
        status: ["active"],
        warning: "Bulk imports write directly to production — double-check your CSV before importing.",
      },
      {
        title: "Manage Main Sets",
        description: "Create and organize master set categories",
        href: "/admin/main-sets",
        icon: FolderOpen,
        color: "bg-green-500",
        status: ["active"],
      },
      {
        title: "Unassigned Sets",
        description: "Assign orphaned card sets to master sets",
        href: "/admin/unassigned-sets",
        icon: Edit,
        color: "bg-orange-500",
        status: ["active"],
      },
      {
        title: "Upcoming Sets Tracker",
        description: "Release calendar with RSS auto-sync and manual entry",
        href: "/admin/upcoming-sets",
        icon: Calendar,
        color: "bg-red-500",
        status: ["active"],
      },
      {
        title: "Upcoming Set Intelligence",
        description: "Multi-source detection of new Marvel releases with review workflow",
        href: "/admin/set-intelligence",
        icon: Calendar,
        color: "bg-indigo-500",
        status: ["active"],
      },
      {
        title: "Base Set Population",
        description: "Clone card data from a variant set into an empty base set",
        href: "/admin/base-set-population",
        icon: Copy,
        color: "bg-teal-500",
        status: ["active", "dangerous"],
        warning: "Copies hundreds of rows into production sets. Review the suggested source carefully.",
      },
    ],
  },
  {
    title: "Images",
    blurb: "Card image approvals, automation, and migration",
    icon: Image,
    tools: [
      {
        title: "Image Approvals",
        description: "Review and approve or reject user-submitted card photos",
        href: "/admin/image-approvals",
        icon: Image,
        color: "bg-pink-500",
        status: ["active"],
      },
      {
        title: "Image Automation",
        description: "Bulk image updater, nightly COMC → Cloudinary migration status, and eBay image lookup",
        href: "/admin/automation",
        icon: Settings,
        color: "bg-gray-500",
        status: ["active"],
        warning: "Bulk operations consume eBay API quota and overwrite card images.",
      },
    ],
  },
  {
    title: "Notifications",
    blurb: "Email tools, campaign history, and delivery testing",
    icon: Mail,
    tools: [
      {
        title: "Email & Notifications",
        description: "All email activity with open/click rates, test emails, and past campaign history",
        href: "/admin/notifications",
        icon: Mail,
        color: "bg-rose-500",
        status: ["active"],
        warning: "Some tools on this page send real email. Every send requires an extra confirmation.",
      },
      {
        title: "Push Notifications",
        description: "Send app push notifications to iOS/Android devices — by segment or single user, with send history",
        href: "/admin/push-notifications",
        icon: Mail,
        color: "bg-orange-500",
        status: ["active"],
        warning: "Sends real push notifications to collectors' devices. Segment sends require confirmation.",
      },
    ],
  },
  {
    title: "APIs & Integrations",
    blurb: "Status and diagnostics for external services",
    icon: Plug,
    tools: [
      {
        title: "RevenueCat Audit",
        description: "Find iOS subscribers whose plan didn't activate — dry run first, then fix (lives on the Conversion Funnel page)",
        href: "/admin/analytics",
        icon: TrendingUp,
        color: "bg-blue-600",
        status: ["active"],
      },
      {
        title: "Marketplace Payouts",
        description: "Seller payout requests and approvals (Stripe). Marketplace is currently feature-flagged off",
        href: "/admin/payouts",
        icon: CreditCard,
        color: "bg-emerald-600",
        status: ["legacy", "coming_soon"],
      },
    ],
  },
  {
    title: "Data & Migrations",
    blurb: "Structural changes to the card database — use with care",
    icon: Database,
    tools: [
      {
        title: "Migration Console",
        description: "Move cards between sets and archive legacy sets, with preview, type-to-confirm, audit logs, and rollback",
        href: "/admin/migration-console",
        icon: ArrowLeftRight,
        color: "bg-indigo-500",
        status: ["active", "dangerous"],
        warning: "Modifies production card data. Always run the preview first — it has full dry-run support.",
      },
      {
        title: "Data Quality — Duplicate Numbers",
        description: "Audit cards sharing the same number in a subset, classify them, and apply dry-run-first fixes and merges with audit logs",
        href: "/admin/data-quality",
        icon: Database,
        color: "bg-rose-600",
        status: ["active", "dangerous"],
        warning: "Analysis is read-only. Fixes/merges require explicit confirmation and are audit-logged; duplicates are archived, never deleted.",
      },
    ],
  },
  {
    title: "Advanced / Legacy Tools",
    blurb: "Rarely used or older tools kept out of the main flow — not for everyday use",
    icon: Archive,
    tools: [
      {
        title: "Legacy Tools",
        description: "PriceCharting importer and the old background scheduler — kept for reference, use only if you know why",
        href: "/admin/legacy-tools",
        icon: Archive,
        color: "bg-slate-500",
        status: ["legacy", "needs_review"],
        warning: "These older tools have fewer guardrails and may overlap with newer automated jobs.",
      },
    ],
  },
];

function ToolCard({ tool }: { tool: AdminTool }) {
  const IconComponent = tool.icon;
  return (
    <Link href={tool.href}>
      <Card className="hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 bg-white h-full">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-lg ${tool.color}`}>
                <IconComponent className="h-5 w-5 text-white" />
              </div>
              <CardTitle className="text-base text-gray-900">{tool.title}</CardTitle>
            </div>
          </div>
          {tool.status && tool.status.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {tool.status.map((s) => (
                <Badge key={s} variant="outline" className={`text-[10px] px-1.5 py-0 ${STATUS_BADGES[s].className}`}>
                  {STATUS_BADGES[s].label}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-gray-600 text-sm">{tool.description}</p>
          {tool.warning && (
            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
              <span>{tool.warning}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ['/api/admin/stats'],
    refetchInterval: 60000, // Refresh every minute
  });
  const {
    data: subscriptionTruth,
    isLoading: subscriptionTruthLoading,
    isError: subscriptionTruthError,
  } = useQuery<SubscriptionTruthResponse>({
    queryKey: ['/api/admin/subscription-truth'],
    refetchInterval: 60000,
  });
  const [showSubscribers, setShowSubscribers] = useState(false);
  const [showCardStats, setShowCardStats] = useState(false);

  return (
    <div className="space-y-6">
      {/* Sticky Stats Header */}
      <div className="sticky top-0 z-10 bg-gradient-to-r from-gray-800 to-gray-900 text-white px-6 py-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <span className="text-xs text-gray-400">Live stats • Auto-refreshing</span>
        </div>
        {/* Row 1: Engagement */}
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div className="flex items-center gap-3">
            <Users className="h-8 w-8 text-blue-400" />
            <div>
              <div className="text-2xl font-bold">
                {statsLoading ? '...' : stats?.totalUsers?.toLocaleString() || '0'}
              </div>
              <div className="text-xs text-gray-400">Total Users</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Users className="h-8 w-8 text-purple-400" />
            <div>
              <div className="text-2xl font-bold">
                {statsLoading ? '...' : stats?.monthlyActiveUsers?.toLocaleString() || '0'}
              </div>
              <div className="text-xs text-gray-400">Active Users</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-green-400" />
            <div>
              <div className="text-2xl font-bold">
                {statsLoading ? '...' : `${stats?.mauPercent || 0}%`}
              </div>
              <div className="text-xs text-gray-400">MAU (30 days)</div>
            </div>
          </div>
        </div>

        {/* Row 1b: provider-confirmed subscription truth */}
        <div className="rounded-lg bg-black/20 border border-white/10 px-4 py-3 mb-3">
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 text-left"
            onClick={() => setShowSubscribers(!showSubscribers)}
            data-testid="button-toggle-subscribers"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-300 flex items-center gap-2">
              Subscription truth
              <span className="text-sm font-bold normal-case tracking-normal text-green-400">
                {subscriptionTruthLoading
                  ? 'Loading…'
                  : subscriptionTruthError || !subscriptionTruth
                    ? 'Unavailable'
                    : `${subscriptionTruth.summary.paying.toLocaleString()} paying`}
              </span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              {showSubscribers ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </span>
          </button>
          {showSubscribers && (<>
          {subscriptionTruthLoading ? (
            <div className="mt-3 text-sm text-gray-400">Loading current billing states…</div>
          ) : subscriptionTruthError || !subscriptionTruth ? (
            <div className="mt-3 rounded border border-red-400/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              Subscription truth is unavailable. Totals are hidden rather than shown as zero.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mt-2">
                {[
                  { label: "Paying (includes scheduled)", value: subscriptionTruth.summary.paying, color: "text-green-400" },
                  { label: "Complimentary", value: subscriptionTruth.summary.complimentary, color: "text-blue-300" },
                  { label: "Cancellation scheduled (subset of paying)", value: subscriptionTruth.summary.cancellationScheduled, color: "text-amber-300" },
                  { label: "Payment declined — recovering", value: subscriptionTruth.summary.paymentDeclined, color: "text-orange-300" },
                  { label: "Churned — canceled", value: subscriptionTruth.summary.churnedCanceled, color: "text-red-300" },
                  { label: "Churned — payment declined", value: subscriptionTruth.summary.churnedDeclined, color: "text-red-300" },
                  { label: "Unknown", value: subscriptionTruth.summary.unknown, color: "text-gray-300" },
                ].map(item => (
                  <div key={item.label}>
                    <div className={`text-2xl font-bold ${item.color}`}>{item.value.toLocaleString()}</div>
                    <div className="text-xs text-gray-400 leading-tight">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-gray-500">
                Paying includes cancellation scheduled; do not add those totals together. Payment status and feature access are tracked separately.
                <Link href="/admin/analytics"><span className="ml-1 text-blue-400 hover:underline">View customers and recent changes →</span></Link>
              </div>
            </>
          )}
          </>)}
        </div>

        {/* Row 2: Card Stats (collapsible) */}
        <div className="rounded-lg bg-black/20 border border-white/10 px-4 py-3">
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 text-left"
            onClick={() => setShowCardStats(!showCardStats)}
            data-testid="button-toggle-card-stats"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-300 flex items-center gap-2">
              Card Stats
              <span className="text-sm font-bold normal-case tracking-normal text-gray-100">
                {statsLoading ? '...' : (stats?.totalCards ?? 0).toLocaleString()} cards
              </span>
            </span>
            {showCardStats ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>
          {showCardStats && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
            <div className="flex items-center gap-3">
              <Layers className="h-8 w-8 text-orange-400" />
              <div>
                <div className="text-2xl font-bold">
                  {statsLoading ? '...' : stats?.totalSets?.toLocaleString() || '0'}
                </div>
                <div className="text-xs text-gray-400">Total Sets</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <CreditCard className="h-8 w-8 text-red-400" />
              <div>
                <div className="text-2xl font-bold">
                  {statsLoading ? '...' : stats?.totalCards?.toLocaleString() || '0'}
                </div>
                <div className="text-xs text-gray-400">Total Cards</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ImageOff className="h-8 w-8 text-gray-400" />
              <div>
                <div className="text-2xl font-bold">
                  {statsLoading ? '...' : stats?.cardsWithoutImages?.toLocaleString() || '0'}
                </div>
                <div className="text-xs text-gray-400">Missing Images</div>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Categorized tool sections */}
      <div className="px-6 pb-10 space-y-8">
        {ADMIN_SECTIONS.map((section) => {
          const SectionIcon = section.icon;
          const isLegacySection = section.title === "Advanced / Legacy Tools";
          return (
            <div key={section.title}>
              <div className="flex items-center gap-2 mb-1">
                <SectionIcon className={`h-5 w-5 ${isLegacySection ? "text-slate-400" : "text-gray-700"}`} />
                <h2 className={`text-lg font-semibold ${isLegacySection ? "text-slate-500" : "text-gray-900"}`}>
                  {section.title}
                </h2>
              </div>
              <p className="text-sm text-gray-500 mb-3">{section.blurb}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {section.tools.map((tool) => (
                  <ToolCard key={`${section.title}-${tool.href}-${tool.title}`} tool={tool} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
