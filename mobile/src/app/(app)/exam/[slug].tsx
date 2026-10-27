import { useLocalSearchParams } from "expo-router";
import { CloudOff } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { isApiError } from "@/api/errors";
import { AppText } from "@/components/app-text";
import { Badge, badgeIconColor } from "@/components/badge";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { fetchExam } from "@/features/exams/api";
import { statusOf } from "@/features/exams/exam-card";
import { relativeOrDate, shortGap } from "@/features/exams/time";
import type { StudentExamDetail } from "@/features/exams/types";
import { formatDateTime, formatDecimal } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { useServerNow } from "@/lib/use-server-now";
import { colors, radius, space } from "@/theme";

/** One exam: what it is (questions, marks, time, negative marking, schedule, language),
 * its instructions, and what this student can do now with the reason when they cannot —
 * all decided by the server (`GET /exams/{slug}/`). Starting and continuing open the exam
 * room (next Mobile App slice). */
export default function ExamDetailScreen() {
  const { t } = useTranslation();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const load = useCallback(() => fetchExam(slug), [slug]);
  const { data, error, loading, refreshing, refresh, retry } = useRemote(load);
  const now = useServerNow(data?.server_time);
  const missing = isApiError(error) && error.status === 404;

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand600]} tintColor={colors.brand600} />}
    >
      <PageHeader title={data?.title ?? t("exams:title")} eyebrow={data ? [data.category.name, data.subject?.name].filter(Boolean).join(" · ") : undefined} />
      {loading ? (
        <View style={styles.skeleton} accessible accessibilityLabel={t("loading")} accessibilityState={{ busy: true }}>
          {[48, 180, 120].map((height, index) => (
            <View key={index} style={[styles.block, { height }]} />
          ))}
        </View>
      ) : null}
      {!data && missing ? <Banner tone="info" message={t("exams:detail.notFound")} /> : null}
      {!data && error && !missing ? (
        <View style={styles.failed}>
          <CloudOff size={36} color={colors.inkSubtle} />
          <AppText color={colors.inkMuted} align="center" role="alert">
            {describeError(error, t)}
          </AppText>
          <Button label={t("retry")} variant="secondary" onPress={retry} />
        </View>
      ) : null}
      {data && error ? <Banner tone="info" message={t("home:stale")} /> : null}
      {data ? <Details exam={data} now={now} /> : null}
    </Screen>
  );
}

function Details({ exam, now }: { exam: StudentExamDetail; now: number }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const n = (value: number) => localizeDigits(value, language);
  const status = statusOf(exam);
  const negative = Number(exam.negative_marks) > 0;
  const facts: [string, string][] = [
    [t("exams:detail.questions"), n(exam.total_questions)],
    [t("exams:detail.totalMarks"), formatDecimal(exam.total_marks, language)],
    [t("exams:detail.duration"), t("exams:minutes", { n: n(exam.duration_minutes) })],
    [t("exams:detail.negative"), negative ? t("exams:detail.negativeValue", { value: formatDecimal(exam.negative_marks, language) }) : t("exams:detail.noNegative")],
  ];
  if (exam.pass_marks !== null) facts.push([t("exams:detail.passMarks"), formatDecimal(exam.pass_marks, language)]);
  if (exam.start_at) facts.push([t("exams:detail.starts"), formatDateTime(exam.start_at, language)]);
  if (exam.end_at) facts.push([t("exams:detail.ends"), formatDateTime(exam.end_at, language)]);
  facts.push([t("exams:detail.language"), t(`exams:contentLanguage.${exam.content_language}`)]);
  facts.push([
    t("exams:detail.attempts"),
    exam.attempts_allowed === null
      ? t("exams:detail.attemptsUnlimited", { used: n(exam.attempts_used) })
      : t("exams:detail.attemptsOf", { used: n(exam.attempts_used), allowed: n(exam.attempts_allowed) }),
  ]);

  return (
    <>
      <View style={styles.badges}>
        <Badge label={t(`exams:examType.${exam.exam_type}`)} tone={exam.exam_type === "live" ? "danger" : "info"} />
        <Badge label={t(`exams:access.${exam.access_type}`)} tone={exam.access_type === "free" ? "success" : "neutral"} />
        {status ? (
          <Badge label={t(`exams:status.${status.key}`)} tone={status.tone} icon={<status.Icon size={14} color={badgeIconColor(status.tone)} />} />
        ) : null}
      </View>
      <StatePanel exam={exam} now={now} />
      {exam.description ? <AppText color={colors.inkMuted}>{exam.description}</AppText> : null}
      <Card style={styles.facts}>
        <AppText weight="bold" role="heading">
          {t("exams:detail.facts")}
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
      {exam.instructions ? (
        <Card style={styles.instructions}>
          <AppText weight="bold" role="heading">
            {t("exams:detail.instructions")}
          </AppText>
          <AppText>{exam.instructions}</AppText>
        </Card>
      ) : null}
    </>
  );
}

/** What the student can do now, in one sentence from the server's flags. */
function StatePanel({ exam, now }: { exam: StudentExamDetail; now: number }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  if (exam.can_resume) return <Banner tone="info" message={t("exams:state.resume")} />;
  if (exam.can_start && exam.seconds_if_started_now !== null) {
    const seconds = exam.seconds_if_started_now;
    const time = shortGap(now + seconds * 1000, now, t, language) ?? t("exams:minutes", { n: localizeDigits(Math.floor(seconds / 60), language) });
    const late = seconds < exam.duration_minutes * 60;
    return <Banner tone="success" message={t(late ? "exams:state.readyLate" : "exams:state.ready", { time })} />;
  }
  if (!exam.locked_reason) return null;
  const when = exam.start_at ? relativeOrDate("starts", exam.start_at, now, t, language) : "";
  return <Banner tone="info" message={t(`exams:state.${exam.locked_reason}`, { when })} />;
}

const styles = StyleSheet.create({
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  facts: { gap: space.xs },
  fact: { flexDirection: "row", gap: space.md, paddingVertical: space.sm },
  factLine: { borderTopWidth: 1, borderTopColor: colors.line },
  factLabel: { flex: 1 },
  factValue: { flexShrink: 1, textAlign: "right" },
  instructions: { gap: space.sm },
  skeleton: { gap: space.md },
  block: { borderRadius: radius.card, backgroundColor: colors.line },
  failed: { alignItems: "center", gap: space.md, marginTop: space.huge },
});
