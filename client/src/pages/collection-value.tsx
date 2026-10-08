import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { CollectionValueList } from "@/components/collection/collection-value-list";

export default function CollectionValue() {
  return (
    <div className="min-h-[100dvh] bg-gray-50 px-4 py-5 pb-20 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <Link href="/my-collection" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-red-600"><ArrowLeft className="h-4 w-4" />My Collection</Link>
        <header>
          <h1 className="font-bebas text-3xl tracking-wide text-gray-900">Most Valuable Cards</h1>
          <p className="mt-1 text-sm text-gray-500">Your collection, ranked by cached market price.</p>
          <Link href="/trends" className="mt-3 inline-block text-sm text-red-600 hover:underline">See market trends →</Link>
        </header>
        <CollectionValueList showSummary />
      </div>
    </div>
  );
}
