import { Trophy } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { formatDate, formatDecimal } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { colors, space } from "@/theme";

import type { DashboardResult } from "./types";

/** A visible result: marks out of total and percentage exactly as the server calculated
 * them, pass/fail when the exam has a pass mark, merit position once it is generated. */
export function ResultRow({ result }: { result: DashboardResult }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  return (
    <View style={styles.row}>
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
          {t("home:result.marks", { obtained: formatDecimal(result.obtained_marks, language), total: formatDecimal(result.total_marks, language) })}
        </AppText>
        <AppText variant="small" color={colors.inkMuted}>
          {t("home:result.percent", { value: formatDecimal(result.percentage, language) })}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.md, paddingVertical: space.md },
  main: { flex: 1, gap: 2 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xs },
  score: { alignItems: "flex-end" },
});
