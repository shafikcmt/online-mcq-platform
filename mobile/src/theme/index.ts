/** Design tokens for the Mobile App — the same values the Admin Panel uses
 * (`admin/src/app/globals.css`) and `docs/UI_UX_GUIDELINES.md` §2. Components use these
 * tokens only: no hard-coded colors, spacing or font sizes. Light mode only in Phase-1. */
export const colors = {
  brand950: "#071D4A",
  brand800: "#0F3A8F",
  brand700: "#1349B0",
  brand600: "#175FD6",
  brand100: "#DCEBFD",
  brand50: "#EEF5FF",
  accent500: "#F2B233",
  canvas: "#F6F8FB",
  surface: "#FFFFFF",
  line: "#E3E8EF",
  lineStrong: "#CFD7E3",
  ink: "#0F172A",
  inkMuted: "#475569",
  inkSubtle: "#5B6B80",
  success700: "#15803D",
  success50: "#ECFDF3",
  warning700: "#B45309",
  warning50: "#FFF8EB",
  danger700: "#B91C1C",
  danger50: "#FEF2F2",
  info700: "#0369A1",
  info50: "#ECF8FF",
  white: "#FFFFFF",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;

export const radius = { control: 8, card: 12, sheet: 16, full: 999 } as const;

/** Type scale (UI_UX_GUIDELINES §2.2). Bangla gets a taller line height in `AppText`. */
export const fontSize = { caption: 12, small: 14, body: 16, lead: 18, h4: 20, h3: 24, h2: 30 } as const;

/** Minimum touch target (dp). */
export const touchTarget = 48;

export type FontWeight = "regular" | "medium" | "semibold" | "bold";

/** Bundled font families (loaded in the root layout). Noto Sans Bengali also covers Latin,
 * so Bangla screens use it for everything; English screens use Inter. */
export const fontFamily: Record<"latin" | "bengali", Record<FontWeight, string>> = {
  latin: { regular: "Inter_400Regular", medium: "Inter_500Medium", semibold: "Inter_600SemiBold", bold: "Inter_700Bold" },
  bengali: {
    regular: "NotoSansBengali_400Regular",
    medium: "NotoSansBengali_500Medium",
    semibold: "NotoSansBengali_600SemiBold",
    bold: "NotoSansBengali_700Bold",
  },
};
