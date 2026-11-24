import { useEffect, useState } from 'react';
import { AI_STATUS_WORDS, pickStatusWordIndex } from '../ai/statusWords';

export function useRotatingStatusWord(
  active: boolean,
  intervalMs = 4200
): string {
  const [index, setIndex] = useState(() => pickStatusWordIndex(-1));

  useEffect(() => {
    if (!active) return;
    setIndex((previous) => pickStatusWordIndex(previous));
    const timer = window.setInterval(() => {
      setIndex((previous) => pickStatusWordIndex(previous));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);

  return AI_STATUS_WORDS[index] ?? AI_STATUS_WORDS[0];
}
