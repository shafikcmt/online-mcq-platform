import { router, useLocalSearchParams } from "expo-router";
import { Archive, CalendarDays, ChevronRight, CloudOff, Medal, PlayCircle, Trophy } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { isApiError } from "@/api/errors";
import { AppText } from "@/components/app-text";
import { Badge, badgeIconColor } from "@/components/badge";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { startAttempt } from "@/features/attempt/api";
import { ShortcutGrid } from "@/features/category/shortcuts";
import { handOff } from "@/features/attempt/handoff";
import { fetchExam } from "@/features/exams/api";
import { examMaterialCount } from "@/features/materials/api";
import { fetchParticipation, type Participation } from "@/features/sample/api";
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
 * all decided by the server (`GET /exams/{slug}/`). Start (after a confirmation) and
 * Continue open the exam room; the server starts a new attempt or returns the open one. */
export default function ExamDetailScreen() {
  const { t, i18n } = useTranslation();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const load = useCallback(() => fetchExam(slug), [slug]);
  const { data, error, loading, refreshing, refresh, retry } = useRemote(load);
  const now = useServerNow(data?.server_time);
  // Study materials of this exam (a small public request; a failure just hides the link).
  const loadMaterials = useCallback(() => examMaterialCount(slug).catch(() => 0), [slug]);
  const materials = useRemote(loadMaterials).data ?? 0;
  // Real students and sample participants are counted apart (null = unknown: no line is shown).
  const loadParticipation = useCallback(() => fetchParticipation(slug), [slug]);
  const participation = useRemote(loadParticipation).data ?? null;
  const missing = isApiError(error) && error.status === 404;
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);

  async function open() {
    if (opening || !data) return;
    setConfirming(false);
    setOpening(true);
    setStartError(null);
    try {
      const room = await startAttempt(data.slug);
      handOff(room);
      router.push({ pathname: "/attempt/[id]", params: { id: room.attempt_id } });
    } catch (failure) {
      setStartError(failure); // e.g. the window just closed: the server's own message
      void refresh();
    } finally {
      setOpening(false);
    }
  }

  const action = data?.can_resume ? "continue" : data?.can_start ? "start" : null;
  return (
    <Screen
      footer={
        action ? (
          <Button
            label={opening ? t("room:starting") : t(`room:${action}`)}
            loading={opening}
            onPress={() => (action === "start" ? setConfirming(true) : void open())}
          />
        ) : data?.locked_reason === "needs_subscription" ? (
          <Button label={t("packages:seePackages")} onPress={() => router.push("/packages")} />
        ) : undefined
      }
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
      {startError ? <Banner tone="error" message={describeError(startError, t)} /> : null}
      {data ? <Details exam={data} now={now} materials={materials} participation={participation} /> : null}
      {data ? (
        <ConfirmDialog
          open={confirming}
          title={t("room:startTitle")}
          body={t("room:startBody", { time: timeIfStarted(data, now, t, i18n.language) })}
          confirmLabel={t("room:start")}
          onConfirm={() => void open()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </Screen>
  );
}

function Details({ exam, now, materials, participation }: { exam: StudentExamDetail; now: number; materials: number; participation: Participation | null }) {
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
  if (participation && participation.total_count > 0) {
    facts.push([
      t("exams:detail.participants"),
      participation.sample_count > 0
        ? t("exams:detail.participantsMixed", { total: n(participation.total_count), real: n(participation.real_count), sample: n(participation.sample_count) })
        : t("exams:detail.participantsReal", { count: participation.real_count, n: n(participation.real_count) }),
    ]);
  }
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
      {exam.start_at && Date.parse(exam.start_at) <= now && (!exam.end_at || Date.parse(exam.end_at) > now) ? (
        <View style={styles.liveBand} accessible accessibilityRole="text">
          <View style={styles.liveTitle}>
            <View style={styles.liveDot} />
            <AppText weight="bold" color={colors.brand950}>
              {t("exams:live.title")}
            </AppText>
          </View>
          {exam.end_at ? (
            <AppText variant="small" color={colors.brand800} align="center">
              {t("exams:live.until", { date: formatDateTime(exam.end_at, language) })}
            </AppText>
          ) : null}
        </View>
      ) : null}
      <StatePanel exam={exam} now={now} />
      {exam.description ? <AppText color={colors.inkMuted}>{exam.description}</AppText> : null}
      <ShortcutGrid
        items={[
          { key: "routine", label: t("category:routine"), href: { pathname: "/routine", params: { category: exam.category.slug, categoryName: exam.category.name } }, Icon: CalendarDays },
          { key: "results", label: t("category:results"), href: "/results", Icon: Trophy },
          { key: "archive", label: t("category:archive"), href: { pathname: "/exams", params: { when: "ended", category: exam.category.slug, categoryName: exam.category.name } }, Icon: Archive },
          { key: "merit", label: t("category:merit"), href: { pathname: "/leaderboard/[slug]", params: { slug: exam.slug } }, Icon: Medal },
        ]}
      />
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
      {exam.syllabus?.length ? (
        <Card style={styles.instructions} accessibilityLabel={t("exams:detail.syllabus")}>
          <AppText weight="bold" role="heading">
            {t("exams:detail.syllabus")}
          </AppText>
          {exam.syllabus.map((line, index) => (
            <View key={index} style={[styles.syllabusLine, index > 0 && styles.factLine]}>
              <AppText variant="small" color={colors.inkSubtle} style={styles.syllabusNumber}>
                {localizeDigits(index + 1, i18n.language)}
              </AppText>
              <View style={styles.syllabusText}>
                {(["subject", "chapter", "topic"] as const).map((part) =>
                  line[part] ? (
                    <AppText key={part} variant={part === "topic" ? "body" : "small"} weight={part === "subject" ? "semibold" : "regular"} color={part === "topic" ? colors.ink : colors.inkMuted}>
                      {line[part]}
                    </AppText>
                  ) : null,
                )}
              </View>
            </View>
          ))}
        </Card>
      ) : null}
      {materials > 0 ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("exams:detail.materials", { count: materials, n: n(materials) })}
          onPress={() => router.push({ pathname: "/materials", params: { exam: exam.slug } })}
          style={({ pressed }) => [styles.materials, pressed && styles.pressed]}
        >
          <PlayCircle size={22} color={colors.brand700} />
          <AppText weight="semibold" color={colors.brand700} style={styles.materialsText}>
            {t("exams:detail.materials", { count: materials, n: n(materials) })}
          </AppText>
          <ChevronRight size={18} color={colors.brand700} />
        </Pressable>
      ) : null}
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

/** "30 min" — the time a new attempt would get now (less when joining late). */
function timeIfStarted(exam: StudentExamDetail, now: number, t: TFunction, language: string): string {
  const seconds = exam.seconds_if_started_now ?? exam.duration_minutes * 60;
  return shortGap(now + seconds * 1000, now, t, language) ?? t("exams:minutes", { n: localizeDigits(Math.floor(seconds / 60), language) });
}

/** What the student can do now, in one sentence from the server's flags. */
function StatePanel({ exam, now }: { exam: StudentExamDetail; now: number }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  if (exam.can_resume) return <Banner tone="info" message={t("exams:state.resume")} />;
  if (exam.can_start && exam.seconds_if_started_now !== null) {
    const time = timeIfStarted(exam, now, t, language);
    const late = exam.seconds_if_started_now < exam.duration_minutes * 60;
    return <Banner tone="success" message={t(late ? "exams:state.readyLate" : "exams:state.ready", { time })} />;
  }
  if (!exam.locked_reason) return null;
  const when = exam.start_at ? relativeOrDate("starts", exam.start_at, now, t, language) : "";
  return <Banner tone="info" message={t(`exams:state.${exam.locked_reason}`, { when })} />;
}

const styles = StyleSheet.create({
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  liveBand: { alignItems: "center", gap: space.xs, padding: space.lg, borderRadius: radius.card, backgroundColor: colors.brand100 },
  liveTitle: { flexDirection: "row", alignItems: "center", gap: space.sm },
  liveDot: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.danger700 },
  facts: { gap: space.xs },
  fact: { flexDirection: "row", gap: space.md, paddingVertical: space.sm },
  factLine: { borderTopWidth: 1, borderTopColor: colors.line },
  factLabel: { flex: 1 },
  factValue: { flexShrink: 1, textAlign: "right" },
  instructions: { gap: space.sm },
  materials: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.brand100, backgroundColor: colors.brand50 },
  materialsText: { flex: 1 },
  pressed: { opacity: 0.85 },
  syllabusLine: { flexDirection: "row", gap: space.md, paddingVertical: space.sm },
  syllabusNumber: { minWidth: 22 },
  syllabusText: { flex: 1, gap: 2 },
  skeleton: { gap: space.md },
  block: { borderRadius: radius.card, backgroundColor: colors.line },
  failed: { alignItems: "center", gap: space.md, marginTop: space.huge },
});
