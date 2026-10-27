import { CalendarClock, CheckCircle2, Clock3, Lock, PlayCircle } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge, badgeIconColor, type BadgeTone } from "@/components/badge";
import { Card } from "@/components/card";
import { localizeDigits } from "@/lib/text";
import { colors, space } from "@/theme";

import { relativeOrDate } from "./time";
import type { DashboardExam } from "./types";

type Status = { key: "resume" | "done" | "locked" | "ready"; tone: BadgeTone; Icon: typeof Lock };

/** What the student can do with the exam, from the server's own flags (never re-derived
 * here): continue, already done, needs a package, open to start, or not startable now. */
function statusOf(exam: DashboardExam): Status | null {
  if (exam.can_resume) return { key: "resume", tone: "warning", Icon: PlayCircle };
  if (!exam.has_access) return { key: "locked", tone: "neutral", Icon: Lock };
  if (exam.can_start) return { key: "ready", tone: "success", Icon: PlayCircle };
  if (exam.attempt_state === "finished") return { key: "done", tone: "brand", Icon: CheckCircle2 };
  return null; // e.g. an upcoming exam: its start time says it all
}

/** One exam on Home: title, type / free-or-paid / duration, its time window from server
 * time and what the student can do. Opening an exam arrives with the exam screens. */
export function ExamCard({ exam, now, upcoming }: { exam: DashboardExam; now: number; upcoming?: boolean }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const status = statusOf(exam);
  let when: string | null = null;
  if (upcoming && exam.start_at) when = relativeOrDate("starts", exam.start_at, now, t, language);
  else if (exam.end_at) when = relativeOrDate("ends", exam.end_at, now, t, language);
  return (
    <Card style={styles.card}>
      <View style={styles.badges}>
        <Badge label={t(`home:examType.${exam.exam_type}`)} tone={exam.exam_type === "live" ? "danger" : "info"} />
        <Badge label={t(`home:access.${exam.access_type}`)} tone={exam.access_type === "free" ? "success" : "neutral"} />
      </View>
      <AppText weight="semibold">{exam.title}</AppText>
      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <Clock3 size={16} color={colors.inkSubtle} />
          <AppText variant="small" color={colors.inkMuted}>
            {t("home:minutes", { n: localizeDigits(exam.duration_minutes, language) })}
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
          label={t(`home:status.${status.key}`)}
          tone={status.tone}
          icon={<status.Icon size={14} color={badgeIconColor(status.tone)} />}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  meta: { flexDirection: "row", flexWrap: "wrap", columnGap: space.lg, rowGap: space.xs },
  metaItem: { flexDirection: "row", alignItems: "center", gap: space.xs },
});
