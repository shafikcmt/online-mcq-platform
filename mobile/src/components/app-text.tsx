import { Text, type TextProps, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { hasBengali } from "@/lib/text";
import { colors, fontFamily, fontSize, type FontWeight } from "@/theme";

type Variant = keyof typeof fontSize;

export type AppTextProps = TextProps & {
  variant?: Variant;
  weight?: FontWeight;
  color?: string;
  align?: TextStyle["textAlign"];
  /** Content language when it is not the UI language (e.g. exam content). */
  lang?: "bn" | "en";
  children?: React.ReactNode;
};

function flatText(children: React.ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(flatText).join("");
  return "";
}

/** Every piece of text in the app. Picks the bundled font for the script: Noto Sans Bengali
 * (which also covers Latin) for Bangla UI or any text containing Bangla, Inter otherwise,
 * and gives Bangla the taller line height its vowel signs and conjuncts need. Respects the
 * system font size (no `allowFontScaling={false}` anywhere). */
export function AppText({ variant = "body", weight = "regular", color = colors.ink, align, lang, style, children, ...rest }: AppTextProps) {
  const { i18n } = useTranslation();
  const bengali = lang ? lang === "bn" : i18n.language === "bn" || hasBengali(flatText(children));
  const size = fontSize[variant] + (bengali && variant !== "h2" && variant !== "h3" ? 1 : 0);
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: fontFamily[bengali ? "bengali" : "latin"][weight],
          fontSize: size,
          lineHeight: Math.round(size * (bengali ? 1.65 : 1.45)),
          color,
          textAlign: align,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
