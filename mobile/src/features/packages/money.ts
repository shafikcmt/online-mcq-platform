import { formatDecimal } from "@/lib/format";

const SYMBOLS: Record<string, string> = { BDT: "৳" };

/** "৳500" / "৳৫০০" — the amount exactly as the server sent it, without trailing zeros. */
export function formatMoney(amount: string, currency: string, language: string): string {
  const symbol = SYMBOLS[currency];
  const value = formatDecimal(amount, language);
  return symbol ? `${symbol}${value}` : `${value} ${currency}`;
}
