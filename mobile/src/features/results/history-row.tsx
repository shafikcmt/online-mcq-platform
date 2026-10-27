import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { formatDate } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { colors, radius, space } from "@/theme";

import type { HistoryItem } from "./types";

/** One attempt in the history. An open attempt goes back to the exam room; a finished
 * one opens its result (or says the result is not out yet). */
export function HistoryRow({ item, now }: { item: HistoryItem; now: number }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  // "In progress" only while the server would still accept it; afterwards it is finalized.
  const open = item.status === "in_progress" && Date.parse(item.deadline_at) > now;
  const status = open ? "in_progress" : item.status === "in_progress" ? "auto_submitted" : item.status;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[item.exam.title, t(`results:status.${status}`)].join(", ")}
      onPress={() =>
        open
          ? router.push({ pathname: "/attempt/[id]", params: { id: item.attempt_id } })
          : router.push({ pathname: "/result/[id]", params: { id: item.attempt_id } })
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.body}>
        <AppText weight="semibold">{item.exam.title}</AppText>
        <AppText variant="small" color={colors.inkMuted}>
          {[t("results:attemptNo", { n: localizeDigits(item.attempt_no, language) }), formatDate(item.submitted_at ?? item.started_at, language)].join(" · ")}
        </AppText>
        <Badge label={t(`results:status.${status}`)} tone={open ? "warning" : "neutral"} />
      </View>
      <ChevronRight size={20} color={colors.inkSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
  },
  pressed: { backgroundColor: colors.brand50 },
  body: { flex: 1, gap: space.xs },
});
