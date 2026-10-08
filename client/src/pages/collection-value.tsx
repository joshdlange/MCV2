import { Link } from "wouter";
import { ArrowLeft, TrendingUp, Trophy } from "lucide-react";
import { CollectionValueList } from "@/components/collection/collection-value-list";
import valueBanner from "@/assets/most-valuable-cards-banner.webp";

export default function CollectionValue() {
  return (
    <div className="min-h-[100dvh] bg-gray-50 px-4 py-5 pb-20 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-600 text-[#fffaf7]"><Trophy aria-hidden="true" className="h-4 w-4" /></div>
            <h1 className="font-bebas text-2xl tracking-wide text-gray-900">Most Valuable Cards</h1>
          </div>
          <div className="value-page-banner">
            <img src={valueBanner} width={1024} height={344} alt="Your collection, ranked by market price. Marvel cards in gold-lit display cases." fetchPriority="high" data-testid="value-page-banner" />
          </div>
          <nav aria-label="Collection navigation" className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Link href="/my-collection" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#e6dfcf] bg-[#faf8f3] px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:border-[#9b732e] hover:bg-[#f4efe4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"><ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />My Collection</Link>
            <Link href="/trends" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#e6dfcf] bg-[#faf8f3] px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:border-[#9b732e] hover:bg-[#f4efe4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"><TrendingUp aria-hidden="true" className="h-4 w-4 shrink-0" />Market Trends</Link>
          </nav>
        </header>
        <CollectionValueList showSummary />
      </div>
    </div>
  );
}
