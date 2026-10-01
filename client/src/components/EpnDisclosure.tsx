// eBay Partner Network affiliate disclosure (EPN Participation Requirements §I.G).
// Exact approved wording; do not add other statements about eBay or EPN.
// eBay sections use the "Sponsored · " prefix; the site-wide sidebar line omits it.
export const EPN_DISCLOSURE = "As an eBay Partner Network affiliate, MCV earns from qualifying purchases.";
export const EPN_SPONSORED_DISCLOSURE = `Sponsored · ${EPN_DISCLOSURE}`;

export function EpnDisclosure({ tone = "light", sponsored = true, className = "" }: {
  tone?: "light" | "dark"; sponsored?: boolean; className?: string;
}) {
  return (
    <p className={`text-xs ${tone === "dark" ? "text-gray-400" : "text-gray-500"} ${className}`} data-testid="epn-disclosure">
      {sponsored ? EPN_SPONSORED_DISCLOSURE : EPN_DISCLOSURE}
    </p>
  );
}
