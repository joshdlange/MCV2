import React from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, FolderOpen, Edit, PlusCircle, Settings, Calendar, Image, ArrowLeftRight, Copy } from "lucide-react";

export default function AdminDashboard() {
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
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
      </div>

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

      <div className="mt-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Admin Quick Stats</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">1,103</div>
            <div className="text-sm text-gray-600">Total Sets</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">60,000+</div>
            <div className="text-sm text-gray-600">Total Cards</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">Active</div>
            <div className="text-sm text-gray-600">System Status</div>
          </div>
        </div>
      </div>
    </div>
  );
}