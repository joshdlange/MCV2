import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Archive, AlertTriangle, CreditCard, ExternalLink } from "lucide-react";
import SchedulerManager from "@/components/admin/scheduler-manager";
import { PriceChartingImporter } from "@/components/admin/pricecharting-importer";

export default function AdminLegacyTools() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900 dark:text-white">Advanced / Legacy Tools</h1>
          <p className="text-gray-600 dark:text-gray-300">
            Older or rarely used tools, kept out of the main admin flow. Nothing here runs automatically from this page.
          </p>
        </div>
        <Badge variant="secondary" className="flex items-center gap-2">
          <Archive className="h-3 w-3" />
          Legacy
        </Badge>
      </div>

      <Card className="border border-amber-200 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="pt-4 pb-4">
          <p className="text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              These tools predate the current automated jobs and have fewer guardrails. The nightly pricing
              backfill and the nightly COMC → Cloudinary image migration already handle most of what the
              old scheduler did. Only use these if you know exactly why.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Marketplace payouts (feature-flagged) */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
          Marketplace Payouts
          <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">Coming Soon</Badge>
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          The marketplace is currently feature-flagged off for users, so this tool has nothing to process yet.
        </p>
        <Link href="/admin/payouts">
          <Card className="hover:shadow-md transition-shadow cursor-pointer border border-gray-200 bg-white max-w-md">
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-600">
                <CreditCard className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">Seller Payout Requests</p>
                <p className="text-xs text-gray-500">Review and approve marketplace seller payouts (Stripe)</p>
              </div>
              <ExternalLink className="h-4 w-4 text-gray-400" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <Separator />

      {/* Old background scheduler */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
          Background Scheduler (Old)
          <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">Needs Review</Badge>
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Legacy job scheduler that overlaps with the newer nightly crons. Kept for reference — avoid enabling
          jobs here without checking they don't double up with the nightly pricing backfill or image migration.
        </p>
        <SchedulerManager />
      </div>

      <Separator />

      {/* PriceCharting importer */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
          PriceCharting Importer
          <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">Needs Review</Badge>
          <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Dangerous</Badge>
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Bulk-imports card data from PriceCharting. May be stale — verify it's still needed before running.
          There is no dry-run, so treat any import as a permanent write to the card database.
        </p>
        <PriceChartingImporter />
      </div>
    </div>
  );
}
