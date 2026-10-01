// eBay Partner Network affiliate disclosure (EPN Participation Requirements §I.G).
// Exact approved wording; do not add other statements about eBay or EPN.
export const EPN_DISCLOSURE = "Sponsored · As an eBay Partner Network affiliate, MCV earns from qualifying purchases.";

export function EpnDisclosure({ tone = "light", className = "" }: { tone?: "light" | "dark"; className?: string }) {
  return (
    <p className={`text-xs ${tone === "dark" ? "text-gray-400" : "text-gray-500"} ${className}`} data-testid="epn-disclosure">
      {EPN_DISCLOSURE}
    </p>
  );
}
