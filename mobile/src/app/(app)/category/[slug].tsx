import { router, useLocalSearchParams } from "expo-router";
import { Archive, CalendarDays, CloudOff, PlayCircle, Trophy } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { ShortcutBar } from "@/features/category/shortcuts";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchExams } from "@/features/exams/api";
import { relativeOrDate } from "@/features/exams/time";
import type { ExamWhen, StudentExam } from "@/features/exams/types";
import { localizeDigits, tidyName } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { useServerNow } from "@/lib/use-server-now";
import { colors, radius, space } from "@/theme";

const SLUG = /^[a-z0-9-]{1,140}$/;
type Row = { exam: StudentExam; when: ExamWhen };

/** One category: its exams as a clear list, running ones first (a red "Live" mark on a scheduled
 * exam that is running now), then upcoming, then past ones marked "Archived". Under the list, the
 * shortcuts a student needs next: past exams, results, the routine and study materials. The first
 * page of each group is shown; "See all" opens the Exams tab for the rest. */
export default function CategoryScreen() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const params = useLocalSearchParams<{ slug: string; name?: string }>();
  const slug = SLUG.test(params.slug ?? "") ? params.slug : "";
  const load = useCallback(async () => {
    const [open, upcoming, ended] = await Promise.all((["open", "upcoming", "ended"] as const).map((when) => fetchExams(when, 1, slug)));
    return { open, upcoming, ended, server_time: open.server_time };
  }, [slug]);
  const { data, error, loading, refreshing, refresh, retry } = useRemote(load);
  const now = useServerNow(data?.server_time);

  const rows: Row[] = data ? (["open", "upcoming", "ended"] as const).flatMap((when) => data[when].results.map((exam) => ({ exam, when }))) : [];
  const total = data ? data.open.count + data.upcoming.count + data.ended.count : 0;
  const name = tidyName(params.name || rows[0]?.exam.category.name || "") || t("exams:title");

  return (
    <Screen
      footer={
        <ShortcutBar
          items={[
            { key: "archive", label: t("category:archive"), href: { pathname: "/exams", params: { when: "ended", category: slug, categoryName: name } }, Icon: Archive },
            { key: "results", label: t("category:results"), href: "/results", Icon: Trophy },
            { key: "routine", label: t("category:routine"), href: { pathname: "/routine", params: { category: slug, categoryName: name } }, Icon: CalendarDays },
            { key: "materials", label: t("category:materials"), href: "/materials", Icon: PlayCircle },
          ]}
        />
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand600]} tintColor={colors.brand600} />}
    >
      <PageHeader title={name} subtitle={data ? t("category:count", { count: total, n: localizeDigits(total, language) }) : undefined} />
      {loading ? (
        <View style={styles.list} accessible accessibilityLabel={t("loading")} accessibilityState={{ busy: true }}>
          {[56, 56, 56, 56].map((height, index) => (
            <View key={index} style={[styles.block, { height }]} />
          ))}
        </View>
      ) : null}
      {!data && error ? (
        <View style={styles.failed}>
          <CloudOff size={36} color={colors.inkSubtle} />
          <AppText color={colors.inkMuted} align="center" role="alert">
            {describeError(error, t)}
          </AppText>
          <Button label={t("retry")} variant="secondary" onPress={retry} />
        </View>
      ) : null}
      {data && error ? <Banner tone="info" message={t("home:stale")} /> : null}
      {data && rows.length === 0 ? <EmptyNote text={t("category:empty")} /> : null}
      {rows.length ? (
        <View style={styles.list}>
          {rows.map(({ exam, when }) => (
            <ExamRow key={exam.slug} exam={exam} when={when} now={now} />
          ))}
        </View>
      ) : null}
      {data && total > rows.length ? (
        <Button label={t("category:seeAll")} variant="secondary" onPress={() => router.push({ pathname: "/exams", params: { category: slug, categoryName: name } })} />
      ) : null}
    </Screen>
  );
}

function ExamRow({ exam, when, now }: Row & { now: number }) {
  const { t, i18n } = useTranslation();
  // "Live" is a scheduled exam that is running now; an exam with no schedule is simply open.
  const live = when === "open" && exam.start_at !== null;
  const mark = live ? "live" : when === "upcoming" ? "upcoming" : when === "ended" ? "archived" : null;
  let time: string | null = null;
  if (when === "upcoming" && exam.start_at) time = relativeOrDate("starts", exam.start_at, now, t, i18n.language);
  else if (when === "open" && exam.end_at) time = relativeOrDate("ends", exam.end_at, now, t, i18n.language);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[exam.title, mark ? t(`category:mark.${mark}`) : null, time].filter(Boolean).join(", ")}
      onPress={() => router.push({ pathname: "/exam/[slug]", params: { slug: exam.slug } })}
      style={({ pressed }) => [styles.row, when === "ended" && styles.rowPast, pressed && styles.pressed]}
    >
      <View style={styles.rowText}>
        <AppText weight="semibold" numberOfLines={2} color={when === "ended" ? colors.inkMuted : colors.ink}>
          {exam.title}
        </AppText>
        {time ? (
          <AppText variant="caption" color={colors.inkMuted}>
            {time}
          </AppText>
        ) : null}
      </View>
      {mark ? (
        <View style={styles.mark}>
          {live ? <View style={styles.dot} /> : null}
          <AppText variant="caption" weight="bold" color={live ? colors.danger700 : mark === "upcoming" ? colors.info700 : colors.inkSubtle}>
            {t(`category:mark.${mark}`)}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.sheet,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  rowPast: { backgroundColor: colors.canvas, borderColor: colors.line },
  rowText: { flex: 1, gap: 2 },
  mark: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.danger700 },
  pressed: { backgroundColor: colors.brand50, borderColor: colors.brand600 },
  block: { borderRadius: radius.sheet, backgroundColor: colors.line },
  failed: { alignItems: "center", gap: space.md, marginTop: space.huge },
});
