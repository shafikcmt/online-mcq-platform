import { CheckCircle2 } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { formatDecimal } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { colors, space } from "@/theme";

import type { SessionState } from "./session";

/** After submitting: the result if the exam shows it at once, otherwise when it will be
 * available. The score is the server's, never computed here. */
export function FinishedView({ state, onDone }: { state: SessionState; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const n = (value: number) => localizeDigits(value, language);
  const result = state.result?.result_available ? state.result.result : null;
  const title = !state.result ? t("room:done.already") : state.timedOut ? t("room:done.timedOut") : t("room:done.title");
  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <CheckCircle2 size={48} color={colors.success700} />
        <AppText variant="h3" weight="bold" align="center" role="heading">
          {title}
        </AppText>
        <AppText color={colors.inkMuted} align="center">
          {state.room.exam.title}
        </AppText>
      </View>
      {result ? (
        <Card style={styles.card}>
          <AppText weight="bold" role="heading">
            {t("room:done.score")}
          </AppText>
          <View style={styles.score}>
            <AppText variant="h2" weight="bold" color={colors.brand800}>
              {t("room:done.marks", { obtained: formatDecimal(result.obtained_marks, language), total: formatDecimal(result.total_marks, language) })}
            </AppText>
            <AppText variant="lead" color={colors.inkMuted}>
              {t("room:done.percent", { value: formatDecimal(result.percentage, language) })}
            </AppText>
          </View>
          {result.is_passed === null ? null : (
            <Badge label={t(result.is_passed ? "home:result.passed" : "home:result.failed")} tone={result.is_passed ? "success" : "danger"} />
          )}
          <View style={styles.counts}>
            <Count label={t("room:done.correct")} value={n(result.correct_count)} color={colors.success700} />
            <Count label={t("room:done.wrong")} value={n(result.wrong_count)} color={colors.danger700} />
            <Count label={t("room:done.unanswered")} value={n(result.unanswered_count)} color={colors.inkMuted} />
          </View>
        </Card>
      ) : (
        <Card>
          <AppText color={colors.inkMuted}>{t("room:done.pending")}</AppText>
        </Card>
      )}
      <Button label={t("room:done.close")} onPress={onDone} />
    </View>
  );
}

function Count({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.count}>
      <AppText variant="h4" weight="bold" color={color}>
        {value}
      </AppText>
      <AppText variant="caption" color={colors.inkMuted} align="center">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
  hero: { alignItems: "center", gap: space.sm, marginTop: space.xl },
  card: { gap: space.md },
  score: { flexDirection: "row", alignItems: "baseline", gap: space.md, flexWrap: "wrap" },
  counts: { flexDirection: "row", gap: space.sm },
  count: { flex: 1, alignItems: "center", gap: 2, paddingVertical: space.sm, borderRadius: 8, backgroundColor: colors.canvas },
});
