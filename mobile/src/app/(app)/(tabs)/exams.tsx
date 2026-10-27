import { useLocalSearchParams } from "expo-router";
import { CloudOff } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { Segmented } from "@/components/segmented";
import { ExamCard } from "@/features/exams/exam-card";
import type { ExamWhen } from "@/features/exams/types";
import { useExamPages } from "@/features/exams/use-exam-pages";
import { EmptyNote } from "@/features/dashboard/section";
import { localizeDigits } from "@/lib/text";
import { useServerNow } from "@/lib/use-server-now";
import { colors, radius, space } from "@/theme";

const FILTERS: ExamWhen[] = ["open", "upcoming", "ended"];
const isWhen = (value: unknown): value is ExamWhen => FILTERS.includes(value as ExamWhen);

/** Exams tab: every exam the student may see, by "open now", "upcoming" and "past", with
 * the same per-exam status as Home (from the server). Tapping an exam opens its details. */
export default function ExamsScreen() {
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ when?: string }>();
  const [when, setWhen] = useState<ExamWhen>(isWhen(params.when) ? params.when : "open");
  const [linked, setLinked] = useState(params.when);
  if (params.when !== linked) {
    // Opened again from a Home "See all" link with another filter.
    setLinked(params.when);
    if (isWhen(params.when)) setWhen(params.when);
  }
  const list = useExamPages(when);
  const now = useServerNow(list.serverTime);

  const header = (
    <View style={styles.header}>
      <View style={styles.titleBlock}>
        <AppText variant="h3" weight="bold" role="heading">
          {t("exams:title")}
        </AppText>
        <AppText color={colors.inkMuted}>{t("exams:subtitle")}</AppText>
      </View>
      <Segmented
        label={t("exams:filters.label")}
        value={when}
        onChange={setWhen}
        options={FILTERS.map((value) => ({ value, label: t(`exams:filters.${value}`) }))}
      />
      {!list.loading && list.items.length > 0 ? (
        <AppText variant="small" color={colors.inkMuted}>
          {t("exams:count", { n: localizeDigits(list.count, i18n.language) })}
        </AppText>
      ) : null}
      {list.items.length > 0 && list.error ? <Banner tone="info" message={t("home:stale")} /> : null}
    </View>
  );

  let empty: React.ReactElement;
  if (list.loading) {
    empty = (
      <View style={styles.skeleton} accessible accessibilityLabel={t("loading")} accessibilityState={{ busy: true }}>
        {[120, 120, 120].map((height, index) => (
          <View key={index} style={[styles.block, { height }]} />
        ))}
      </View>
    );
  } else if (list.error) {
    empty = (
      <View style={styles.failed}>
        <CloudOff size={36} color={colors.inkSubtle} />
        <AppText color={colors.inkMuted} align="center" role="alert">
          {describeError(list.error, t)}
        </AppText>
        <Button label={t("retry")} variant="secondary" onPress={list.retry} />
      </View>
    );
  } else {
    empty = <EmptyNote text={t(`exams:empty.${when}`)} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        testID="exam-list"
        data={list.items}
        keyExtractor={(exam) => exam.slug}
        renderItem={({ item }) => <ExamCard exam={item} now={now} upcoming={when === "upcoming"} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          list.loadingMore ? (
            <View style={styles.more} accessible accessibilityLabel={t("exams:loadingMore")}>
              <ActivityIndicator color={colors.brand600} />
            </View>
          ) : undefined
        }
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[colors.brand600]} tintColor={colors.brand600} />}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: space.lg, paddingVertical: space.xxl, width: "100%", maxWidth: 560, alignSelf: "center" },
  header: { gap: space.lg, marginBottom: space.lg },
  titleBlock: { gap: space.xs },
  gap: { height: space.md },
  skeleton: { gap: space.md },
  block: { borderRadius: radius.card, backgroundColor: colors.line },
  failed: { alignItems: "center", gap: space.md, marginTop: space.xxl },
  more: { paddingVertical: space.xl },
});
