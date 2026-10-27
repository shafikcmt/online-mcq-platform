import { Clock3 } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { shortGap } from "@/features/exams/time";
import { colors, radius, space } from "@/theme";

import { formatClock } from "./format";

/** Time left until the server's deadline. Turns amber under 5 minutes and red under 1
 * (with the words changing for screen readers, not only the color). */
export function Timer({ remainingMs }: { remainingMs: number }) {
  const { t, i18n } = useTranslation();
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const tone = seconds <= 60 ? colors.danger700 : seconds <= 300 ? colors.warning700 : colors.ink;
  const background = seconds <= 60 ? colors.danger50 : seconds <= 300 ? colors.warning50 : colors.canvas;
  const spoken = shortGap(remainingMs, 0, t, i18n.language) ?? formatClock(seconds, i18n.language);
  return (
    <View
      style={[styles.box, { backgroundColor: background, borderColor: tone + "33" }]}
      accessible
      role="timer"
      accessibilityLabel={t("room:timeLeftLabel", { time: spoken })}
    >
      <Clock3 size={18} color={tone} />
      <AppText weight="bold" color={tone} style={styles.digits}>
        {formatClock(seconds, i18n.language)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.full, borderWidth: 1 },
  digits: { fontVariant: ["tabular-nums"] },
});
