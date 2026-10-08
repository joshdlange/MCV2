import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { CollectionValueList } from "@/components/collection/collection-value-list";
import valueBanner from "@/assets/most-valuable-cards-banner.webp";

export default function CollectionValue() {
  return (
    <div className="min-h-[100dvh] bg-gray-50 px-4 py-5 pb-20 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <Link href="/my-collection" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#e6dfcf] bg-[#faf8f3] px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:border-[#9b732e] hover:bg-[#f4efe4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"><ArrowLeft aria-hidden="true" className="h-4 w-4" />My Collection</Link>
        <header className="space-y-3">
          <h1 className="sr-only">Most Valuable Cards</h1>
          <div className="value-page-banner">
            <img src={valueBanner} width={1024} height={344} alt="Your collection, ranked by market price. Marvel cards in gold-lit display cases." fetchPriority="high" data-testid="value-page-banner" />
          </div>
          <Link href="/trends" className="inline-block text-sm text-red-600 hover:underline">See market trends →</Link>
        </header>
        <CollectionValueList showSummary />
      </div>
    </div>
  );
}
