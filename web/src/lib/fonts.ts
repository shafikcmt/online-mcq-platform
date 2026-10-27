import localFont from "next/font/local";

/** The site's two typefaces, self-hosted through next/font: the files are preloaded with
 * the page (not discovered late from CSS), and a size-matched fallback keeps text from
 * jumping when they arrive. Only the subsets the site uses: Latin (Inter) and Bengali
 * (Noto Sans Bengali). Variable fonts: one file covers every weight. No generic fallback
 * here: globals.css lists Inter, then Bengali, then the system fonts, so Bangla letters
 * reach Noto Sans Bengali before any system font. */
export const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-inter",
});

export const bengali = localFont({
  src: "../../node_modules/@fontsource-variable/noto-sans-bengali/files/noto-sans-bengali-bengali-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-bengali",
});
