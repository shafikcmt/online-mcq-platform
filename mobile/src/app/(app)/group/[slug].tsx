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
import { fetchGroup } from "@/features/category/groups";
import { ShortcutBar } from "@/features/category/shortcuts";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchExams } from "@/features/exams/api";
import { localizeDigits, tidyName } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { useServerNow } from "@/lib/use-server-now";
import { colors, radius, space } from "@/theme";

const SLUG = /^[a-z0-9-]{1,140}$/;

/** One group of a category ("Subject-wise preparation", "52nd BCS preparation"): its sub-groups as
 * rows, then the exams sitting directly in it (running first, then upcoming, then past ones marked
 * "Archived"), and under them the shortcuts a student needs next. The title says where it sits. */
export default function GroupScreen() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const params = useLocalSearchParams<{ slug: string; name?: string }>();
  const slug = SLUG.test(params.slug ?? "") ? params.slug : "";
  const load = useCallback(async () => {
    const group = await fetchGroup(slug);
    const shelf = { group: slug };
    const [open, upcoming, ended] = await Promise.all((["open", "upcoming", "ended"] as const).map((when) => fetchExams(when, 1, undefined, shelf)));
    return { group, open, upcoming, ended, server_time: open.server_time };
  }, [slug]);
  const { data, error, loading, refreshing, refresh, retry } = useRemote(load);
  const now = useServerNow(data?.server_time);

  const rows: ExamRowItem[] = data ? (["open", "upcoming", "ended"] as const).flatMap((when) => data[when].results.map((exam) => ({ exam, when }))) : [];
  const examTotal = data ? data.open.count + data.upcoming.count + data.ended.count : 0;
  const children = (data?.group.children ?? []).filter((child) => child.exam_count > 0);
  const name = tidyName(data?.group.name || params.name || "") || t("exams:title");
  const category = data?.group.category;
  const parent = data?.group.parent;
  const where = parent ? parent.name : category?.name;

  return (
    <Screen
      footer={
        category ? (
          <ShortcutBar
            items={[
              { key: "archive", label: t("category:archive"), href: { pathname: "/exams", params: { when: "ended", category: category.slug, categoryName: tidyName(category.name) } }, Icon: Archive },
              { key: "results", label: t("category:results"), href: "/results", Icon: Trophy },
              { key: "routine", label: t("category:routine"), href: { pathname: "/routine", params: { category: category.slug, categoryName: tidyName(category.name) } }, Icon: CalendarDays },
              { key: "materials", label: t("category:materials"), href: "/materials", Icon: PlayCircle },
            ]}
          />
        ) : undefined
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand600]} tintColor={colors.brand600} />}
    >
      <PageHeader
        title={name}
        subtitle={data ? [where ? tidyName(where) : null, t("category:count", { count: data.group.exam_count, n: localizeDigits(data.group.exam_count, language) })].filter(Boolean).join(" · ") : undefined}
      />
      {loading ? (
        <View style={styles.list} accessible accessibilityLabel={t("loading")} accessibilityState={{ busy: true }}>
          {[64, 64, 56].map((height, index) => (
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
      {data && children.length === 0 && rows.length === 0 ? <EmptyNote text={t("category:groupEmpty")} /> : null}
      {children.length ? (
        <View style={styles.list}>
          {children.map((child) => (
            <GroupRow key={child.slug} group={child} />
          ))}
        </View>
      ) : null}
      {children.length && rows.length ? (
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
      {data && examTotal > rows.length ? (
        <Button label={t("category:seeAll")} variant="secondary" onPress={() => router.push({ pathname: "/exams", params: { category: category?.slug, categoryName: category ? tidyName(category.name) : undefined } })} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  block: { borderRadius: radius.sheet, backgroundColor: colors.line },
  failed: { alignItems: "center", gap: space.md, marginTop: space.huge },
});
