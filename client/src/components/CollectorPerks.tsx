import { useState, type MouseEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
// Official header logo: actualprints.com/cdn/shop/files/ActualPrintsDesigns.png
import actualPrintsLogo from "@/assets/actual-prints-logo.webp";

const ACTUAL_PRINTS_URL = "https://actualprints.com/";
const ACTUAL_PRINTS_CODE = "MARVELCARDVAULT";

/** Collector offers use the merchant's own checkout; no discount is auto-applied. */
export function CollectorPerks() {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [shopError, setShopError] = useState(false);

  const copyCode = async () => {
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(ACTUAL_PRINTS_CODE);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const openShop = async (event: MouseEvent<HTMLAnchorElement>) => {
    // Match the existing eBay external-browser convention when the native
    // Browser plugin is available. Otherwise keep the normal safe anchor.
    const browser = (window as Window & {
      Capacitor?: { Plugins?: { Browser?: { open(options: { url: string }): Promise<unknown> } } };
    }).Capacitor?.Plugins?.Browser;
    if (!Capacitor.isNativePlatform() || !browser) return;
    event.preventDefault();
    setShopError(false);
    try {
      await browser.open({ url: ACTUAL_PRINTS_URL });
    } catch {
      setShopError(true);
    }
  };

  return (
    <Dialog onOpenChange={() => { setCopyState("idle"); setShopError(false); }}>
      <DialogTrigger asChild>
        <button type="button" aria-label="Actual Prints: $10 off One Touch stickers"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white">
          <img src={actualPrintsLogo} alt="" className="h-7 w-5 object-contain" />
          <span><span className="font-semibold">$10 off</span> One Touch stickers</span>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-xl bg-white text-gray-900 dark:bg-gray-900 dark:text-white">
        <DialogHeader className="text-left">
          <div className="mb-3 flex items-center gap-3">
            <img src={actualPrintsLogo} alt="Actual Prints logo" className="h-14 w-10 object-contain" />
            <span className="text-sm font-semibold">Actual Prints</span>
          </div>
          <DialogTitle>$10 off One Touch stickers</DialogTitle>
          <DialogDescription className="leading-relaxed">
            Custom stickers for your One Touch holders. Use your collector code at checkout.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-red-200 bg-white px-3 py-2">
            <div>
              <p className="text-[11px] font-medium text-gray-500">Use code at checkout</p>
              <code className="select-text text-sm font-bold tracking-wide text-gray-900">{ACTUAL_PRINTS_CODE}</code>
            </div>
            <button type="button" onClick={copyCode} disabled={copyState === "copying"}
              aria-label={copyState === "copied" ? "Code copied" : "Copy checkout code MARVELCARDVAULT"}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-50">
              {copyState === "copied" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copyState === "copied" ? "Copied" : copyState === "copying" ? "Copying…" : "Copy code"}
            </button>
          </div>
          <p role="status" aria-live="polite" className="mt-1 min-h-4 text-xs text-gray-600 dark:text-gray-300">
            {copyState === "copied" && "Code copied. Paste it at checkout."}
            {copyState === "error" && "Couldn't copy. Select MARVELCARDVAULT above and copy it manually."}
          </p>
          <a href={ACTUAL_PRINTS_URL} target="_blank" rel="noopener noreferrer" onClick={openShop}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2">
            Shop Actual Prints <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only"> (opens externally)</span>
          </a>
          {shopError && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">Couldn't open the shop. Please try again or visit actualprints.com in your browser.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}