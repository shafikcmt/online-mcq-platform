import { router } from "expo-router";
import { CalendarClock, CloudOff, Download } from "lucide-react-native";
import * as Linking from "expo-linking";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchRoutine, ROUTINE_PDF_URL } from "@/features/routine/api";
import { dayLabel, groupByDay, isLive, timeRange } from "@/features/routine/group";
import { formatDecimal } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { useServerNow } from "@/lib/use-server-now";
import { colors, space } from "@/theme";

/** The exam routine: every scheduled exam that has not ended, by day, with the routine PDF
 * when the admin has published one. Each exam opens its own screen (syllabus, rules). The
 * schedule is public: no sign-in is needed to read it. */
export default function RoutineScreen() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const remote = useRemote(fetchRoutine);
  const now = useServerNow();
  const days = remote.data ? groupByDay(remote.data.exams) : [];

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
          <EmptyNote text={t("routine:empty")} />
        ) : (
          days.map((day) => (
            <View key={day.key} style={styles.day}>
              <View style={styles.dayHeader}>
                <CalendarClock size={18} color={colors.brand700} />
                <AppText weight="bold" role="heading">
                  {dayLabel(day.key, language)}
                </AppText>
              </View>
              {day.exams.map((exam) => {
                const live = isLive(exam, now);
                return (
                  <Pressable
                    key={exam.slug}
                    accessibilityRole="button"
                    accessibilityLabel={t("routine:open", { title: exam.title })}
                    onPress={() => router.push({ pathname: "/exam/[slug]", params: { slug: exam.slug } })}
                  >
                    <Card style={styles.exam}>
                      <AppText variant="small" weight="semibold" color={colors.brand700}>
                        {timeRange(exam, language)}
                      </AppText>
                      <AppText weight="semibold">{exam.title}</AppText>
                      <AppText variant="small" color={colors.inkMuted}>
                        {[exam.category.name, exam.subject?.name].filter(Boolean).join(" · ")}
                      </AppText>
                      <AppText variant="small" color={colors.inkSubtle}>
                        {t("routine:details", {
                          minutes: localizeDigits(exam.duration_minutes, language),
                          questions: localizeDigits(exam.total_questions, language),
                          marks: formatDecimal(exam.total_marks, language),
                        })}
                      </AppText>
                      <View style={styles.badges}>
                        <Badge label={live ? t("routine:live") : t("routine:upcoming")} tone={live ? "success" : "neutral"} />
                        <Badge label={t(`exams:access.${exam.access_type}`)} tone={exam.access_type === "free" ? "success" : "neutral"} />
                      </View>
                    </Card>
                  </Pressable>
                );
              })}
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
  dayHeader: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm },
  exam: { gap: 2 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xs },
  skeleton: { gap: space.md },
  block: { borderRadius: 12, backgroundColor: colors.line },
  failed: { alignItems: "center", gap: space.md, marginTop: space.huge },
});
