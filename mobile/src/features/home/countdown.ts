/** Whole days / hours / minutes / seconds left until `targetMs` (never negative). */
export function splitCountdown(targetMs: number, nowMs: number) {
  const total = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
    total,
  };
}
