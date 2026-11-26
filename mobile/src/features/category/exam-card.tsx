import { router } from "expo-router";
import { BookOpen, ChevronRight, Clock3, FileQuestion, Trophy } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { relativeOrDate } from "@/features/exams/time";
import type { ExamWhen, StudentExam } from "@/features/exams/types";
import { syllabusText } from "@/features/routine/routine-card";
import { dayKey, dayLabel } from "@/features/routine/group";
import { formatDecimal } from "@/lib/format";
import { localizeDigits, tidyName } from "@/lib/text";
import { colors, radius, space } from "@/theme";

export type ExamCardItem = { exam: StudentExam; when: ExamWhen };

const COLLAPSED_LINES = 2;

/** One exam of a category or group as a card: the day it runs, a mark (a red "Live" for a scheduled
 * exam running now, "Upcoming", "Archived"), marks / minutes / questions, the subject, the syllabus
 * (two lines, the rest behind "Show more"), its study materials and ONE button that says what the
 * student can do: start the live exam, resume, wait for the start (disabled, with when it starts),
 * unlock a paid exam, or view details. Every state is read from the server's own flags. */
export function ExamCard({ exam, when, now }: ExamCardItem & { now: number }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const n = (value: number) => localizeDigits(value, language);
  const [expanded, setExpanded] = useState(false);
  // "Live" is a scheduled exam that is running now; an exam with no schedule is simply open.
  const live = when === "open" && exam.start_at !== null;
  const mark = live ? "live" : when === "upcoming" ? "upcoming" : when === "ended" ? "archived" : null;
  const anchor = exam.start_at ?? exam.end_at;
  const topics = (exam.syllabus ?? []).map(syllabusText).filter(Boolean);
  const shown = expanded ? topics : topics.slice(0, COLLAPSED_LINES);
  const materials = exam.material_count ?? 0;

  const open = () => router.push({ pathname: "/exam/[slug]", params: { slug: exam.slug } });
  let action: { label: string; variant: "primary" | "secondary"; disabled?: boolean };
  if (exam.can_resume) action = { label: t("category:card.resume"), variant: "primary" };
  else if (exam.can_start) action = { label: t(live ? "category:card.startLive" : "category:card.start"), variant: live ? "primary" : "secondary" };
  else if (exam.locked_reason === "exam_not_started" && exam.start_at) action = { label: relativeOrDate("starts", exam.start_at, now, t, language), variant: "secondary", disabled: true };
  else if (exam.locked_reason === "needs_subscription") action = { label: t("category:card.unlock"), variant: "secondary" };
  else action = { label: t("category:card.view"), variant: "secondary" };

  const facts = [
    { Icon: Trophy, text: t("routine:marks", { n: formatDecimal(exam.total_marks, language) }) },
    { Icon: Clock3, text: t("routine:minutes", { n: n(exam.duration_minutes) }) },
    { Icon: FileQuestion, text: t("routine:questions", { count: exam.total_questions, n: n(exam.total_questions) }) },
  ];

  return (
    <View style={[styles.card, live && styles.live, when === "ended" && styles.past]}>
      <View style={styles.top}>
        <AppText variant="lead" weight="bold" style={styles.date}>
          {anchor ? dayLabel(dayKey(anchor), language) : t("category:card.anyTime")}
        </AppText>
        {mark ? (
          live ? (
            <View style={styles.liveMark}>
              <View style={styles.dot} />
              <AppText variant="caption" weight="bold" color={colors.danger700}>
                {t("category:mark.live")}
              </AppText>
            </View>
          ) : (
            <Badge label={t(`category:mark.${mark}`)} tone={mark === "upcoming" ? "info" : "neutral"} />
          )
        ) : null}
        <Badge label={t(exam.access_type === "free" ? "category:card.free" : "category:card.paid")} tone={exam.access_type === "free" ? "success" : "warning"} />
      </View>
      <Pressable accessibilityRole="link" accessibilityLabel={exam.title} onPress={open}>
        <AppText weight="bold" numberOfLines={3} color={when === "ended" ? colors.inkMuted : colors.ink}>
          {tidyName(exam.title)}
        </AppText>
      </Pressable>
      <View style={styles.facts}>
        {facts.map(({ Icon, text }) => (
          <View key={text} style={styles.fact}>
            <Icon size={16} color={colors.inkSubtle} />
            <AppText variant="small" color={colors.inkMuted}>
              {text}
            </AppText>
          </View>
        ))}
      </View>
      {exam.subject ? (
        <AppText variant="small" color={colors.inkMuted}>
          {t("category:card.subject", { name: exam.subject.name })}
        </AppText>
      ) : null}
      {topics.length ? (
        <View style={styles.topics}>
          <AppText variant="small" weight="bold">
            {t("category:card.syllabus")}
          </AppText>
          {shown.map((text, index) => (
            <AppText key={index} variant="small" color={colors.inkMuted}>
              {`${n(index + 1)}. ${text}`}
            </AppText>
          ))}
          {topics.length > COLLAPSED_LINES ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} hitSlop={8} style={styles.more}>
              <AppText variant="small" weight="bold" color={colors.brand700}>
                {t(expanded ? "category:card.less" : "category:card.more")}
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
      <Button label={action.label} variant={action.variant} disabled={action.disabled} onPress={open} accessibilityLabel={`${action.label}: ${exam.title}`} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.sheet, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong },
  live: { borderColor: colors.danger700, borderLeftWidth: 4 },
  past: { backgroundColor: colors.canvas, borderColor: colors.line },
  top: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  date: { flexGrow: 1, flexShrink: 1 },
  liveMark: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.danger700 },
  facts: { flexDirection: "row", flexWrap: "wrap", columnGap: space.lg, rowGap: space.xs },
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
