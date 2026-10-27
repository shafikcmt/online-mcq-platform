import { localizeDigits } from "@/lib/text";

/** "12:05" or "1:02:05" in the UI language's digits. */
export function formatClock(totalSeconds: number, language: string): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return localizeDigits(h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`, language);
}

const LETTERS = { en: "ABCDEFGHIJ", bn: "কখগঘঙচছজঝঞ" } as const;

/** Option label: A, B, C… or ক, খ, গ… */
export function optionLetter(index: number, language: string): string {
  const letters = language === "bn" ? LETTERS.bn : LETTERS.en;
  return letters[index] ?? String(index + 1);
}
