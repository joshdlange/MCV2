import React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, FolderOpen, Edit, PlusCircle, Settings, Calendar, Image, ArrowLeftRight, Copy, TrendingUp, Layers, CreditCard } from "lucide-react";

interface AdminStats {
  totalUsers: number;
  monthlyActiveUsers: number;
  mauPercent: number;
  totalSets: number;
  totalCards: number;
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {/* User Stats First */}
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
            <TrendingUp className="h-8 w-8 text-green-400" />
            <div>
              <div className="text-2xl font-bold">
                {statsLoading ? '...' : `${stats?.mauPercent || 0}%`}
              </div>
              <div className="text-xs text-gray-400">MAU (30 days)</div>
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
          {/* Card Stats */}
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