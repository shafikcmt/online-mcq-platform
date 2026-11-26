import { router, useLocalSearchParams } from "expo-router";
import { Archive, CalendarDays, CloudOff, PlayCircle, Trophy } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { ExamRow, type ExamRowItem } from "@/features/category/exam-row";
import { GroupRow } from "@/features/category/group-row";
import { fetchGroups, type Group } from "@/features/category/groups";
import { ShortcutBar } from "@/features/category/shortcuts";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchExams } from "@/features/exams/api";
import { localizeDigits, tidyName } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { useServerNow } from "@/lib/use-server-now";
import { colors, radius, space } from "@/theme";

const SLUG = /^[a-z0-9-]{1,140}$/;

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
    // The exams that sit in no group are listed under the group rows; the groups themselves may fail to
    // load (an older server): the category then simply lists every exam as before.
    const groups = await fetchGroups(slug).catch(() => [] as Group[]);
    const shelf = { ungrouped: groups.length > 0 };
    const [open, upcoming, ended] = await Promise.all((["open", "upcoming", "ended"] as const).map((when) => fetchExams(when, 1, slug, shelf)));
    return { open, upcoming, ended, groups, server_time: open.server_time };
  }, [slug]);
  const { data, error, loading, refreshing, refresh, retry } = useRemote(load);
  const now = useServerNow(data?.server_time);

  const rows: ExamRowItem[] = data ? (["open", "upcoming", "ended"] as const).flatMap((when) => data[when].results.map((exam) => ({ exam, when }))) : [];
  const groups = data?.groups ?? [];
  const total = data ? data.open.count + data.upcoming.count + data.ended.count + groups.reduce((sum, group) => sum + group.exam_count, 0) : 0;
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
      {data && rows.length === 0 && groups.length === 0 ? <EmptyNote text={t("category:empty")} /> : null}
      {groups.length ? (
        <View style={styles.list}>
          {groups.map((group) => (
            <GroupRow key={group.slug} group={group} />
          ))}
        </View>
      ) : null}
      {groups.length && rows.length ? (
        <AppText weight="bold" role="heading">
          {t("category:examsHeading")}
        </AppText>
      ) : null}
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

const styles = StyleSheet.create({
  list: { gap: space.md },
  section: { gap: space.md },
  block: { borderRadius: radius.sheet, backgroundColor: colors.line },
  failed: { alignItems: "center", gap: space.md, marginTop: space.huge },
});
