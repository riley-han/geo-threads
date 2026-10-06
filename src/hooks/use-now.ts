import { useEffect, useState } from 'react';

/**
 * The current time, re-read every `intervalMs`. Rendering must be pure, so a
 * component that shows "in 3 h" reads the clock through state rather than
 * calling Date.now() while rendering — which also keeps the label current.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
