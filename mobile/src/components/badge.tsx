import { StyleSheet, View } from "react-native";

import { colors, radius, space } from "@/theme";

import { AppText } from "./app-text";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.canvas, fg: colors.inkMuted },
  brand: { bg: colors.brand50, fg: colors.brand700 },
  success: { bg: colors.success50, fg: colors.success700 },
  warning: { bg: colors.warning50, fg: colors.warning700 },
  danger: { bg: colors.danger50, fg: colors.danger700 },
  info: { bg: colors.info50, fg: colors.info700 },
};

/** Small status label. The text always says the status (color is never the only signal). */
export function Badge({ label, tone = "neutral", icon }: { label: string; tone?: BadgeTone; icon?: React.ReactNode }) {
  const { bg, fg } = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: fg + "33" }]}>
      {icon}
      <AppText variant="caption" weight="semibold" color={fg}>
        {label}
      </AppText>
    </View>
  );
}

export const badgeIconColor = (tone: BadgeTone) => TONES[tone].fg;

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
});
