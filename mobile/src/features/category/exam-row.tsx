import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { relativeOrDate } from "@/features/exams/time";
import type { ExamWhen, StudentExam } from "@/features/exams/types";
import { colors, radius, space } from "@/theme";

export type ExamRowItem = { exam: StudentExam; when: ExamWhen };

/** One exam in a category or group list: its title, when it starts or ends, and a mark (a red "Live"
 * for a scheduled exam running now, "Upcoming", "Archived"). Opens the exam's own screen. */
export function ExamRow({ exam, when, now }: ExamRowItem & { now: number }) {
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
});
