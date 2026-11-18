import { router } from "expo-router";
import { BookOpen, ChevronRight, Clock3, FileQuestion, Trophy } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { formatDecimal } from "@/lib/format";
import { localizeDigits, tidyName } from "@/lib/text";
import { colors, radius, space } from "@/theme";

import { timeRange } from "./group";
import type { RoutineExam } from "./types";

const COLLAPSED_LINES = 2;

/** "Math: Algebra, Linear equations" — one syllabus line as plain text. */
export function syllabusText(line: { subject: string; chapter: string; topic: string }): string {
  const detail = [line.chapter, line.topic].filter(Boolean).join(", ");
  return line.subject && detail ? `${line.subject}: ${detail}` : line.subject || detail;
}

/** One exam of the routine, with everything a student plans by: when it runs and whether it is
 * live, marks / time / questions, the topics (two lines, the rest behind "Show more"), its study
 * materials, and one button to the exam. A live exam has a red edge and a "Live" mark. */
export function RoutineCard({ exam, live }: { exam: RoutineExam; live: boolean }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [expanded, setExpanded] = useState(false);
  const n = (value: number) => localizeDigits(value, language);
  const topics = (exam.syllabus ?? []).map(syllabusText).filter(Boolean);
  const shown = expanded ? topics : topics.slice(0, COLLAPSED_LINES);
  const materials = exam.material_count ?? 0;
  const facts = [
    { Icon: Trophy, text: t("routine:marks", { n: formatDecimal(exam.total_marks, language) }) },
    { Icon: Clock3, text: t("routine:minutes", { n: n(exam.duration_minutes) }) },
    { Icon: FileQuestion, text: t("routine:questions", { count: exam.total_questions, n: n(exam.total_questions) }) },
  ];
  return (
    <View style={[styles.card, live && styles.live]}>
      <View style={styles.top}>
        <AppText variant="small" weight="bold" color={colors.brand700} style={styles.time}>
          {timeRange(exam, language)}
        </AppText>
        {live ? (
          <View style={styles.liveMark}>
            <View style={styles.dot} />
            <AppText variant="caption" weight="bold" color={colors.danger700}>
              {t("routine:live")}
            </AppText>
          </View>
        ) : (
          <Badge label={t("routine:upcoming")} tone="info" />
        )}
        <Badge label={t(`exams:access.${exam.access_type}`)} tone={exam.access_type === "free" ? "success" : "warning"} />
      </View>
      <AppText variant="lead" weight="bold">
        {exam.title}
      </AppText>
      <AppText variant="small" color={colors.inkMuted}>
        {[tidyName(exam.category.name), exam.subject?.name].filter(Boolean).join(" · ")}
      </AppText>
      <View style={styles.facts}>
        {facts.map(({ Icon, text }) => (
          <View key={text} style={styles.fact}>
            <Icon size={16} color={colors.inkSubtle} />
            <AppText variant="small" weight="semibold">
              {text}
            </AppText>
          </View>
        ))}
      </View>
      {topics.length ? (
        <View style={styles.topics}>
          <AppText variant="small" weight="bold">
            {t("routine:topics")}
          </AppText>
          {shown.map((text, index) => (
            <AppText key={index} variant="small" color={colors.inkMuted}>
              {`${n(index + 1)}. ${text}`}
            </AppText>
          ))}
          {topics.length > COLLAPSED_LINES ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} hitSlop={8} style={styles.more}>
              <AppText variant="small" weight="bold" color={colors.brand700}>
                {t(expanded ? "routine:less" : "routine:more")}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {materials > 0 ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push({ pathname: "/materials", params: { exam: exam.slug } })}
          style={({ pressed }) => [styles.materials, pressed && styles.pressed]}
          hitSlop={4}
        >
          <BookOpen size={16} color={colors.warning700} />
          <AppText variant="small" weight="semibold" color={colors.warning700}>
            {t("routine:materials", { count: materials, n: n(materials) })}
          </AppText>
          <ChevronRight size={14} color={colors.warning700} />
        </Pressable>
      ) : null}
      <Button
        label={t(live ? "routine:start" : "routine:view")}
        variant={live ? "primary" : "secondary"}
        compact
        accessibilityLabel={t("routine:open", { title: exam.title })}
        onPress={() => router.push({ pathname: "/exam/[slug]", params: { slug: exam.slug } })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.sheet, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong },
  live: { borderColor: colors.danger700, borderLeftWidth: 4 },
  top: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  time: { flexGrow: 1 },
  liveMark: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.danger700 },
  facts: { flexDirection: "row", flexWrap: "wrap", columnGap: space.lg, rowGap: space.xs, paddingVertical: space.xs },
  fact: { flexDirection: "row", alignItems: "center", gap: space.xs },
  topics: { gap: 2, padding: space.md, borderRadius: radius.card, backgroundColor: colors.canvas },
  more: { alignSelf: "flex-start", marginTop: space.xs },
  materials: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.full,
    backgroundColor: colors.warning50,
  },
  pressed: { opacity: 0.8 },
});
