import { useEffect, useState } from "react";

/** Delay network search, not the input itself. Cleanup drops outdated keystrokes. */
export function useDebouncedSearch(value: string, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
