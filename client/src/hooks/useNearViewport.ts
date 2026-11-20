import { useEffect, useRef, useState } from "react";

/** Start optional thumbnail lookups only when the tile approaches the viewport. */
export function useNearViewport() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: "300px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, near };
}
