import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import BulkImageUpdater from "@/components/admin/bulk-image-updater";
import SchedulerManager from "@/components/admin/scheduler-manager";
import { PriceChartingImporter } from "@/components/admin/pricecharting-importer";
import { Settings, Image, Zap, Download } from "lucide-react";

export default function AdminAutomation() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900 dark:text-white">Data & Image Automation</h1>
          <p className="text-gray-600 dark:text-gray-300">Manage automated card data import, image processing, and bulk operations</p>
        </div>
        <Badge variant="secondary" className="flex items-center gap-2">
          <Zap className="h-3 w-3" />
          Admin Tools
        </Badge>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center space-x-2">
              <div className="p-2 rounded-lg bg-purple-500">
                <Download className="h-4 w-4 text-white" />
              </div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Data Import</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              PriceCharting API integration for Marvel card data population
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center space-x-2">
              <div className="p-2 rounded-lg bg-blue-500">
                <Image className="h-4 w-4 text-white" />
              </div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Image Processing</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Automated image finding and processing using eBay Browse API
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center space-x-2">
              <div className="p-2 rounded-lg bg-green-500">
                <Settings className="h-4 w-4 text-white" />
              </div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Rate Limiting</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Configurable delays to respect API limits and prevent rate limiting
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center space-x-2">
              <div className="p-2 rounded-lg bg-purple-500">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Bulk Operations</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Process hundreds of cards with progress tracking and error reporting
            </p>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* PriceCharting Importer */}
      <PriceChartingImporter />

      <Separator />

      {/* Background Scheduler */}
      <SchedulerManager />

      <Separator />

      {/* Bulk Image Updater */}
      <BulkImageUpdater />
    </div>
  );
}