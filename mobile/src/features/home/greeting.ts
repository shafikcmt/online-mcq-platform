/** The greeting for the time of day in Bangladesh (UTC+6, no daylight saving), from the
 * server's clock: morning 05–11, noon 12–15, afternoon 16–17, evening 18–20, night. */
export type DayPart = "morning" | "noon" | "afternoon" | "evening" | "night";

export function dayPart(serverNowMs: number): DayPart {
  const hour = new Date(serverNowMs + 6 * 3_600_000).getUTCHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 16) return "noon";
  if (hour >= 16 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 21) return "evening";
  return "night";
}
