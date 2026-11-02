import { router } from "expo-router";
import { ChevronRight, Trophy } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { formatDate, formatDecimal } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { colors, space } from "@/theme";

import type { DashboardResult } from "@/features/dashboard/types";

type RowResult = Pick<DashboardResult, "attempt_id" | "exam" | "submitted_at" | "obtained_marks" | "total_marks" | "percentage" | "is_passed" | "merit_position">;

/** A visible result: marks out of total and percentage exactly as the server calculated
 * them, pass/fail when the exam has a pass mark, merit position once it is generated.
 * Opens the full result. */
export function ResultRow({ result }: { result: RowResult }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const marks = t("home:result.marks", { obtained: formatDecimal(result.obtained_marks, language), total: formatDecimal(result.total_marks, language) });
  const percent = t("home:result.percent", { value: formatDecimal(result.percentage, language) });
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[result.exam.title, marks, percent].join(", ")}
      onPress={() => router.push({ pathname: "/result/[id]", params: { id: result.attempt_id } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.main}>
        <AppText weight="semibold">{result.exam.title}</AppText>
        <AppText variant="small" color={colors.inkMuted}>
          {formatDate(result.submitted_at, language)}
        </AppText>
        <View style={styles.badges}>
          {result.is_passed === null ? null : (
            <Badge label={t(result.is_passed ? "home:result.passed" : "home:result.failed")} tone={result.is_passed ? "success" : "danger"} />
          )}
          {result.merit_position === null ? null : (
            <Badge
              label={t("home:result.merit", { n: localizeDigits(result.merit_position, language) })}
              tone="brand"
              icon={<Trophy size={14} color={colors.brand700} />}
            />
          )}
        </View>
      </View>
      <View style={styles.score}>
        <AppText variant="lead" weight="bold">
          {marks}
        </AppText>
        <AppText variant="small" color={colors.inkMuted}>
          {percent}
        </AppText>
      </View>
      <ChevronRight size={20} color={colors.inkSubtle} style={styles.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.xs, borderRadius: 8 },
  pressed: { backgroundColor: colors.brand50 },
  chevron: { alignSelf: "center" },
  main: { flex: 1, gap: 2 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xs },
  score: { alignItems: "flex-end" },
});
