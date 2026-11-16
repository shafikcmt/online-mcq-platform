import { useLocalSearchParams } from "expo-router";
import { CalendarClock, CloudOff, Download, X } from "lucide-react-native";
import { useState } from "react";
import * as Linking from "expo-linking";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchRoutine, ROUTINE_PDF_URL } from "@/features/routine/api";
import { dayLabel, groupByDay, isLive } from "@/features/routine/group";
import { RoutineCard } from "@/features/routine/routine-card";
import { useRemote } from "@/lib/use-remote";
import { useServerNow } from "@/lib/use-server-now";
import { colors, radius, space } from "@/theme";

const SLUG = /^[a-z0-9-]{1,140}$/;

/** The exam routine: every scheduled exam that has not ended, by day, with the routine PDF
 * when the admin has published one. Each exam opens its own screen (syllabus, rules). The
 * schedule is public: no sign-in is needed to read it. Opened from a category, it shows that
 * category's exams only, with a chip to show every category again. */
export default function RoutineScreen() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const remote = useRemote(fetchRoutine);
  const now = useServerNow();
  const params = useLocalSearchParams<{ category?: string; categoryName?: string }>();
  const [category, setCategory] = useState(() =>
    params.category && SLUG.test(params.category) ? { slug: params.category, name: params.categoryName || params.category } : null,
  );
  const exams = (remote.data?.exams ?? []).filter((exam) => !category || exam.category.slug === category.slug);
  const days = groupByDay(exams);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={remote.refreshing} onRefresh={remote.refresh} />}
      >
        <PageHeader title={t("routine:title")} subtitle={t("routine:subtitle")} />
        {remote.data?.pdf.available ? (
          <Button label={t("routine:download")} variant="secondary" onPress={() => void Linking.openURL(ROUTINE_PDF_URL)} icon={<Download size={18} color={colors.brand700} />} />
        ) : null}
        {category ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("routine:clear", { name: category.name })} onPress={() => setCategory(null)} style={styles.chip} hitSlop={8}>
            <AppText variant="small" weight="semibold" color={colors.brand700}>
              {category.name}
            </AppText>
            <X size={14} color={colors.brand700} />
          </Pressable>
        ) : null}
        {remote.data && remote.error ? <Banner tone="info" message={t("routine:stale")} /> : null}

        {remote.loading ? (
          <View style={styles.skeleton} accessible accessibilityLabel={t("loading")} accessibilityState={{ busy: true }}>
            {[96, 96, 96].map((height, index) => (
              <View key={index} style={[styles.block, { height }]} />
            ))}
          </View>
        ) : remote.error && !remote.data ? (
          <View style={styles.failed}>
            <CloudOff size={36} color={colors.inkSubtle} />
            <AppText color={colors.inkMuted} align="center" role="alert">
              {describeError(remote.error, t)}
            </AppText>
            <Button label={t("retry")} variant="secondary" onPress={remote.retry} />
          </View>
        ) : days.length === 0 ? (
          <EmptyNote text={t(category ? "routine:emptyCategory" : "routine:empty")} />
        ) : (
          days.map((day) => (
            <View key={day.key} style={styles.day}>
              <View style={styles.dayHeader}>
                <CalendarClock size={18} color={colors.white} />
                <AppText weight="bold" role="heading" color={colors.white}>
                  {dayLabel(day.key, language)}
                </AppText>
              </View>
              {day.exams.map((exam) => (
                <RoutineCard key={exam.slug} exam={exam} live={isLive(exam, now)} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.huge },
  day: { gap: space.sm },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    backgroundColor: colors.brand700,
  },
  chip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.full,
    backgroundColor: colors.brand50,
    borderWidth: 1,
    borderColor: colors.brand100,
  },
  skeleton: { gap: space.md },
  block: { borderRadius: 12, backgroundColor: colors.line },
  failed: { alignItems: "center", gap: space.md, marginTop: space.huge },
});
