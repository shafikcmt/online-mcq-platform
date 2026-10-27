import { router } from "expo-router";
import { CalendarClock, CheckCircle2, ChevronRight, Clock3, Lock, PlayCircle } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge, badgeIconColor, type BadgeTone } from "@/components/badge";
import type { DashboardExam } from "@/features/dashboard/types";
import { localizeDigits } from "@/lib/text";
import { colors, radius, space } from "@/theme";

import { relativeOrDate } from "./time";

type CardExam = Pick<
  DashboardExam,
  "slug" | "title" | "exam_type" | "access_type" | "start_at" | "end_at" | "duration_minutes" | "has_access" | "can_start" | "can_resume" | "attempt_state"
>;
type Status = { key: "resume" | "done" | "locked" | "ready"; tone: BadgeTone; Icon: typeof Lock };

/** What the student can do with the exam, from the server's own flags (never re-derived
 * here): continue, already done, needs a package, or open to start. */
export function statusOf(exam: CardExam): Status | null {
  if (exam.can_resume) return { key: "resume", tone: "warning", Icon: PlayCircle };
  if (!exam.has_access) return { key: "locked", tone: "neutral", Icon: Lock };
  if (exam.can_start) return { key: "ready", tone: "success", Icon: PlayCircle };
  if (exam.attempt_state === "finished") return { key: "done", tone: "brand", Icon: CheckCircle2 };
  return null; // e.g. an upcoming exam: its start time says it all
}

/** One exam in a list: title, type / free-or-paid / duration, its time window counted
 * from server time and what the student can do. Opens the exam's details. */
export function ExamCard({ exam, now, upcoming }: { exam: CardExam; now: number; upcoming?: boolean }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const status = statusOf(exam);
  let when: string | null = null;
  if (upcoming && exam.start_at) when = relativeOrDate("starts", exam.start_at, now, t, language);
  else if (exam.end_at) when = relativeOrDate("ends", exam.end_at, now, t, language);
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push({ pathname: "/exam/[slug]", params: { slug: exam.slug } })}
      accessibilityLabel={[exam.title, when, status ? t(`exams:status.${status.key}`) : null].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.body}>
        <View style={styles.badges}>
          <Badge label={t(`exams:examType.${exam.exam_type}`)} tone={exam.exam_type === "live" ? "danger" : "info"} />
          <Badge label={t(`exams:access.${exam.access_type}`)} tone={exam.access_type === "free" ? "success" : "neutral"} />
        </View>
        <AppText weight="semibold">{exam.title}</AppText>
        <View style={styles.meta}>
          <View style={styles.metaItem}>
            <Clock3 size={16} color={colors.inkSubtle} />
            <AppText variant="small" color={colors.inkMuted}>
              {t("exams:minutes", { n: localizeDigits(exam.duration_minutes, language) })}
            </AppText>
          </View>
          {when ? (
            <View style={styles.metaItem}>
              <CalendarClock size={16} color={colors.inkSubtle} />
              <AppText variant="small" color={colors.inkMuted}>
                {when}
              </AppText>
            </View>
          ) : null}
        </View>
        {status ? (
          <Badge
            label={t(`exams:status.${status.key}`)}
            tone={status.tone}
            icon={<status.Icon size={14} color={badgeIconColor(status.tone)} />}
          />
        ) : null}
      </View>
      <ChevronRight size={20} color={colors.inkSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
  },
  pressed: { backgroundColor: colors.brand50, borderColor: colors.brand100 },
  body: { flex: 1, gap: space.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  meta: { flexDirection: "row", flexWrap: "wrap", columnGap: space.lg, rowGap: space.xs },
  metaItem: { flexDirection: "row", alignItems: "center", gap: space.xs },
});
