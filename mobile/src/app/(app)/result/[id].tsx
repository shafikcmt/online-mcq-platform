import { router, useLocalSearchParams } from "expo-router";
import { CloudOff, Hourglass } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { isApiError } from "@/api/errors";
import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { fetchResult } from "@/features/results/api";
import { formatDuration } from "@/features/results/format";
import type { ResultDetail } from "@/features/results/types";
import { formatDateTime, formatDecimal } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { colors, radius, space } from "@/theme";

/** One result, exactly as the server calculated it: marks, percentage, pass/fail, counts,
 * negative marking, time used and merit position. Links to the answer review (only when
 * the server allows it) and to the exam's leaderboard. While the exam's results are not
 * published (403 `result_not_visible`) it says so. */
export default function ResultScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => fetchResult(id), [id]);
  const { data, error, loading, refreshing, refresh, retry } = useRemote(load);
  const code = isApiError(error) ? error.code : null;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand600]} tintColor={colors.brand600} />}>
      <PageHeader title={data?.exam.title ?? t("results:detail.title")} eyebrow={data ? t("results:detail.title") : undefined} />
      {loading ? <View style={styles.block} accessible accessibilityLabel={t("loading")} accessibilityState={{ busy: true }} /> : null}
      {!data && code === "result_not_visible" ? (
        <View style={styles.center}>
          <Hourglass size={36} color={colors.inkSubtle} />
          <AppText color={colors.inkMuted} align="center">
            {t("results:detail.notVisible")}
          </AppText>
        </View>
      ) : null}
      {!data && isApiError(error) && error.status === 404 ? <Banner tone="info" message={t("results:detail.notFound")} /> : null}
      {!data && error && code !== "result_not_visible" && !(isApiError(error) && error.status === 404) ? (
        <View style={styles.center}>
          <CloudOff size={36} color={colors.inkSubtle} />
          <AppText color={colors.inkMuted} align="center" role="alert">
            {describeError(error, t)}
          </AppText>
          <Button label={t("retry")} variant="secondary" onPress={retry} />
        </View>
      ) : null}
      {data && error ? <Banner tone="info" message={t("home:stale")} /> : null}
      {data ? <Details result={data} /> : null}
    </Screen>
  );
}

function Details({ result }: { result: ResultDetail }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const n = (value: number) => localizeDigits(value, language);
  const d = (value: string) => formatDecimal(value, language);
  let merit = t("results:detail.meritPending");
  if (result.merit_position !== null) merit = n(result.merit_position);
  else if (!result.is_merit_counted && result.attempt_no > 1) merit = t("results:detail.meritNotCounted");
  const facts: [string, string][] = [
    [t("results:detail.positive"), d(result.positive_marks)],
    [t("results:detail.negative"), Number(result.negative_marks_total) > 0 ? `−${d(result.negative_marks_total)}` : d(result.negative_marks_total)],
  ];
  if (result.pass_marks !== null) facts.push([t("results:detail.passMarks"), d(result.pass_marks)]);
  facts.push([t("results:detail.timeUsed"), formatDuration(result.time_used_seconds, t, language)]);
  facts.push([t("results:detail.submitted"), formatDateTime(result.submitted_at, language)]);
  facts.push([t("results:detail.merit"), merit]);

  return (
    <>
      <Card style={styles.scoreCard}>
        <AppText weight="bold" role="heading">
          {t("results:detail.score")}
        </AppText>
        <View style={styles.score}>
          <AppText variant="h2" weight="bold" color={colors.brand800}>
            {t("results:detail.marks", { obtained: d(result.obtained_marks), total: d(result.total_marks) })}
          </AppText>
          <AppText variant="lead" color={colors.inkMuted}>
            {t("results:detail.percent", { value: d(result.percentage) })}
          </AppText>
        </View>
        {result.is_passed === null ? null : (
          <Badge label={t(result.is_passed ? "home:result.passed" : "home:result.failed")} tone={result.is_passed ? "success" : "danger"} />
        )}
        <View style={styles.counts}>
          <Count label={t("results:detail.correct")} value={n(result.correct_count)} color={colors.success700} />
          <Count label={t("results:detail.wrong")} value={n(result.wrong_count)} color={colors.danger700} />
          <Count label={t("results:detail.unanswered")} value={n(result.unanswered_count)} color={colors.inkMuted} />
        </View>
      </Card>
      <Card style={styles.facts}>
        <AppText weight="bold" role="heading">
          {t("results:detail.breakdown")}
        </AppText>
        {facts.map(([label, value], index) => (
          <View key={label} style={[styles.fact, index > 0 && styles.factLine]}>
            <AppText variant="small" color={colors.inkMuted} style={styles.factLabel}>
              {label}
            </AppText>
            <AppText variant="small" weight="semibold" style={styles.factValue}>
              {value}
            </AppText>
          </View>
        ))}
      </Card>
      {result.review_available ? (
        <Button label={t("results:detail.review")} onPress={() => router.push({ pathname: "/review/[id]", params: { id: result.attempt_id } })} />
      ) : (
        <Banner tone="info" message={t("results:detail.reviewUnavailable")} />
      )}
      <Button label={t("results:detail.leaderboard")} variant="secondary" onPress={() => router.push({ pathname: "/leaderboard/[slug]", params: { slug: result.exam.slug } })} />
    </>
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
  block: { height: 220, borderRadius: radius.card, backgroundColor: colors.line },
  center: { alignItems: "center", gap: space.md, marginTop: space.huge },
  scoreCard: { gap: space.md },
  score: { flexDirection: "row", alignItems: "baseline", gap: space.md, flexWrap: "wrap" },
  counts: { flexDirection: "row", gap: space.sm },
  count: { flex: 1, alignItems: "center", gap: 2, paddingVertical: space.sm, borderRadius: radius.control, backgroundColor: colors.canvas },
  facts: { gap: space.xs },
  fact: { flexDirection: "row", gap: space.md, paddingVertical: space.sm },
  factLine: { borderTopWidth: 1, borderTopColor: colors.line },
  factLabel: { flex: 1 },
  factValue: { flexShrink: 1, textAlign: "right" },
});
