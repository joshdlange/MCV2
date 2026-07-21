import type { SVGProps } from "react";

/**
 * Comic-book style lightning bolt — the app-wide icon for XP / Collector Power.
 * Bold, angular silhouette with an inked outline, matching the Marvel comic
 * aesthetic (Bangers headline, halftone mission card).
 *
 * Colors via `currentColor` (use text-* classes). Set `outlined={false}` to
 * drop the ink outline when the bolt sits on a very dark background.
 */
export function ComicBolt({
  outlined = true,
  ...props
}: SVGProps<SVGSVGElement> & { outlined?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        d="M14.8 1.2 L4.6 13.6 h5.3 L7.6 22.8 19.6 9.4 h-5.9 L17.5 1.2 Z"
        fill="currentColor"
        stroke={outlined ? "rgba(0,0,0,0.75)" : "none"}
        strokeWidth={outlined ? 1.5 : 0}
        strokeLinejoin="round"
      />
    </svg>
  );
}
