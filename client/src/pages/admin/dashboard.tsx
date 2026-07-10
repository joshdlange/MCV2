import React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, FolderOpen, Edit, PlusCircle, Settings, Calendar, Image, ArrowLeftRight, Copy, TrendingUp, Layers, CreditCard, ImageOff, DollarSign, BarChart2 } from "lucide-react";

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

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ['/api/admin/stats'],
    refetchInterval: 60000, // Refresh every minute
  });
  const adminTools = [
    {
      title: "Manage Users",
      description: "Add, edit, and manage user accounts and permissions",
      href: "/admin/users",
      icon: Users,
      color: "bg-blue-500"
    },
    {
      title: "Manage Main Sets",
      description: "Create and organize main card set categories",
      href: "/admin/main-sets",
      icon: FolderOpen,
      color: "bg-green-500"
    },
    {
      title: "Unassigned Sets",
      description: "Assign individual card sets to main set categories",
      href: "/admin/unassigned-sets",
      icon: Edit,
      color: "bg-orange-500"
    },
    {
      title: "Add Cards",
      description: "Import new cards and manage card database",
      href: "/admin/cards",
      icon: PlusCircle,
      color: "bg-purple-500"
    },
    {
      title: "Image Automation",
      description: "Process card images and manage automation tools",
      href: "/admin/automation",
      icon: Settings,
      color: "bg-gray-500"
    },
    {
      title: "Upcoming Sets Tracker",
      description: "Manage upcoming Marvel card set releases",
      href: "/admin/upcoming-sets",
      icon: Calendar,
      color: "bg-red-500"
    },
    {
      title: "Image Approvals",
      description: "Review and approve user-submitted card images",
      href: "/admin/image-approvals",
      icon: Image,
      color: "bg-pink-500"
    },
    {
      title: "Migration Console",
      description: "Safely migrate cards between sets with rollback capability",
      href: "/admin/migration-console",
      icon: ArrowLeftRight,
      color: "bg-indigo-500"
    },
    {
      title: "Base Set Population",
      description: "Populate empty base sets by copying card data from variants",
      href: "/admin/base-set-population",
      icon: Copy,
      color: "bg-teal-500"
    },
    {
      title: "Conversion Funnel",
      description: "Track signups → card adds → logins → upgrades → churn",
      href: "/admin/analytics",
      icon: BarChart2,
      color: "bg-yellow-500"
    }
  ];

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

        {/* Row 1b: Subscriber breakdown (every number reconciles to Total Users) */}
        <div className="rounded-lg bg-black/20 border border-white/10 px-4 py-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-300">Subscribers</span>
            {stats?.breakdown && !stats.breakdown.rcCheckOk && (
              <span className="text-[10px] text-amber-400">iPhone/comped split approximate (RevenueCat unreachable)</span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-2xl font-bold text-gray-100">
                {statsLoading ? '...' : (stats?.breakdown?.freeUsers ?? '0').toLocaleString()}
              </div>
              <div className="text-xs text-gray-400">Free (Side Kick)</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-400">
                {statsLoading ? '...' : (stats?.breakdown?.payingTotal ?? '0').toLocaleString()}
              </div>
              <div className="text-xs text-gray-400">
                Paying
                {stats?.breakdown && (
                  <span className="text-gray-500"> · {stats.breakdown.payingStripe} web · {stats.breakdown.payingApple} iPhone</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-400">
                {statsLoading ? '...' : (stats?.breakdown?.comped ?? '0').toLocaleString()}
              </div>
              <div className="text-xs text-gray-400">
                Comped (free grants)
                {stats?.breakdown && stats.breakdown.unknown > 0 && (
                  <span className="text-amber-400"> · {stats.breakdown.unknown} unverified</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-400">
                {statsLoading ? '...' : (stats?.breakdown?.systemAccounts ?? '0').toLocaleString()}
              </div>
              <div className="text-xs text-gray-400">System account</div>
            </div>
          </div>
          {stats?.breakdown && (
            <div className="mt-2 text-[11px] text-gray-500">
              {stats.breakdown.freeUsers.toLocaleString()} free + {stats.breakdown.payingTotal} paying + {stats.breakdown.comped} comped
              {stats.breakdown.unknown > 0 && ` + ${stats.breakdown.unknown} unverified`} + {stats.breakdown.systemAccounts} system = {stats.breakdown.totalUsers.toLocaleString()} total
            </div>
          )}
        </div>

        {/* Row 2: Card Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
      </div>

      <div className="px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {adminTools.map((tool) => {
          const IconComponent = tool.icon;
          return (
            <Link key={tool.href} href={tool.href}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 bg-white">
                <CardHeader className="pb-3">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${tool.color}`}>
                      <IconComponent className="h-6 w-6 text-white" />
                    </div>
                    <CardTitle className="text-lg text-gray-900">{tool.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 text-sm">{tool.description}</p>
                  <Button 
                    variant="outline" 
                    className="mt-4 w-full bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  >
                    Access Tool
                  </Button>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        </div>
      </div>
    </div>
  );
}