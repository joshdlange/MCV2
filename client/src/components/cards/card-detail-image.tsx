import type { ReactNode } from "react";

// Keep the animated glow on its own layer. Animating opacity on an ancestor
// also composites the image and clipped frame, which is unnecessary on WebKit.
export function CardDetailImage({ src, alt, fallback, auraTier, children }: {
  src: string;
  alt: string;
  fallback: string;
  auraTier: string;
  children?: ReactNode;
}) {
  return (
    <div className="card-aura-container">
      <div
        aria-hidden="true"
        className={`absolute inset-0 rounded-xl pointer-events-none aura-${auraTier}`}
        data-testid="card-detail-glow"
      />
      <div
        className="relative overflow-hidden rounded-xl shadow-xl bg-gray-900"
        style={{ width: 280, height: 392 }}
        data-testid="card-detail-image-frame"
      >
        <img
          key={src}
          src={src || fallback}
          alt={alt}
          width={280}
          height={392}
          className="absolute inset-0 block w-full h-full object-contain"
          data-testid="card-detail-image"
          onError={e => {
            // A failed placeholder must not recursively trigger more requests.
            const image = e.currentTarget;
            if (image.dataset.fallbackApplied) return;
            image.dataset.fallbackApplied = "true";
            image.src = fallback;
          }}
        />
        {children}
      </div>
    </div>
  );
}
