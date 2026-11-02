import { useKeepAwake } from "expo-keep-awake";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, ChevronRight, CloudOff, LayoutGrid, LogOut } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Screen } from "@/components/screen";
import { useToast } from "@/components/toast";
import { FinishedView } from "@/features/attempt/finished-view";
import { Palette } from "@/features/attempt/palette";
import { QuestionView } from "@/features/attempt/question-view";
import { progress, type AttemptSession, type SessionState } from "@/features/attempt/session";
import { Timer } from "@/features/attempt/timer";
import { useAttemptSession } from "@/features/attempt/use-attempt-session";
import { localizeDigits } from "@/lib/text";
import { useServerNow } from "@/lib/use-server-now";
import { colors, radius, space, touchTarget } from "@/theme";

/** The exam room. One question at a time, a palette of all questions, mark for review,
 * a countdown to the server's deadline, answers saved as they change (kept on the phone
 * until the server confirms), submit with a summary, and the result when the exam shows
 * it at once. The screen stays awake while it is open. */
export default function AttemptScreen() {
  useKeepAwake();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, state, error, retry } = useAttemptSession(id);

  if (!session || !state) {
    return (
      <Screen>
        {error ? (
          <View style={styles.center}>
            <CloudOff size={36} color={colors.inkSubtle} />
            <AppText weight="semibold" align="center" role="heading">
              {t("room:loadFailed")}
            </AppText>
            <AppText color={colors.inkMuted} align="center" role="alert">
              {describeError(error, t)}
            </AppText>
            <Button label={t("retry")} variant="secondary" onPress={retry} />
            <Button label={t("back")} variant="ghost" onPress={() => router.back()} />
          </View>
        ) : (
          <View style={styles.center} accessible accessibilityLabel={t("loading")}>
            <ActivityIndicator color={colors.brand600} size="large" />
          </View>
        )}
      </Screen>
    );
  }
  if (state.phase === "finished") {
    return (
      <Screen>
        <FinishedView state={state} onDone={() => (router.canGoBack() ? router.back() : router.replace("/home"))} />
      </Screen>
    );
  }
  return <Room session={session} state={state} />;
}

function Room({ session, state }: { session: AttemptSession; state: SessionState }) {
  const { t, i18n } = useTranslation();
  const notify = useToast();
  const now = useServerNow(state.room.server_time, 1000);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [lang, setLang] = useState<"bn" | "en">(state.room.content_language);
  const { room, answers, current, phase, sync } = state;
  const question = room.questions[current];
  const remaining = session.deadline - now;
  const editable = phase === "active" && remaining > 0;
  const counts = progress(state);
  const n = (value: number) => localizeDigits(value, i18n.language);

  // Spoken and shown once each: 5 minutes and 1 minute left.
  const warned = useRef<number>(Infinity);
  useEffect(() => {
    for (const [limit, key] of [
      [60_000, "room:warn1"],
      [300_000, "room:warn5"],
    ] as const) {
      if (remaining > 0 && remaining <= limit && warned.current > limit) {
        warned.current = limit;
        notify(t(key));
        break;
      }
    }
  }, [remaining, notify, t]);

  // Android back button: ask before leaving (the timer keeps running).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setConfirmLeave(true);
      return true;
    });
    return () => sub.remove();
  }, []);

  const submitting = phase === "submitting";
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("room:leave")} onPress={() => setConfirmLeave(true)} hitSlop={8} style={styles.iconButton}>
            <LogOut size={22} color={colors.inkMuted} />
          </Pressable>
          <View style={styles.headerTitle}>
            <AppText variant="small" weight="semibold" numberOfLines={1}>
              {room.exam.title}
            </AppText>
          </View>
          <Timer remainingMs={remaining} />
          <Pressable accessibilityRole="button" accessibilityLabel={t("room:palette")} onPress={() => setPaletteOpen(true)} hitSlop={8} style={styles.iconButton}>
            <LayoutGrid size={22} color={colors.brand700} />
          </Pressable>
        </View>
        <View style={styles.statusRow}>
          <AppText variant="caption" color={colors.inkMuted}>
            {t("room:progress", { answered: n(counts.answered), total: n(counts.total) })}
          </AppText>
          <AppText variant="caption" color={sync === "offline" ? colors.warning700 : colors.inkMuted} accessibilityLiveRegion="polite" style={styles.sync}>
            {t(`room:sync.${sync}`)}
          </AppText>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          {state.blocked ? <Banner tone="error" message={t("room:blocked", { reason: describeError(state.blocked, t) })} /> : null}
          {state.submitError && !submitting ? <Banner tone="error" message={describeError(state.submitError, t)} /> : null}
          {submitting ? <Banner tone="info" message={state.timedOut && state.submitError ? t("room:timeUpRetrying") : t("room:submitting")} /> : null}
          {room.exam.content_language === "both" ? (
            <View style={styles.langRow} role="radiogroup" accessibilityLabel={t("room:showIn")}>
              {(["bn", "en"] as const).map((code) => (
                <Pressable
                  key={code}
                  role="radio"
                  aria-checked={lang === code}
                  accessibilityState={{ checked: lang === code }}
                  onPress={() => setLang(code)}
                  style={[styles.langChip, lang === code && styles.langChipOn]}
                >
                  <AppText variant="small" lang={code} weight={lang === code ? "bold" : "medium"} color={lang === code ? colors.brand700 : colors.inkMuted}>
                    {t(`common:language.${code}`)}
                  </AppText>
                </Pressable>
              ))}
            </View>
          ) : null}
          <QuestionView
            key={question.question_id}
            question={question}
            total={room.questions.length}
            answer={answers[question.question_id]}
            lang={lang}
            negativeMarks={room.exam.negative_marks}
            editable={editable}
            onSelect={(optionId) => session.select(question.question_id, optionId)}
            onToggleMark={() => session.toggleMark(question.question_id)}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerInner}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("room:previous")}
            accessibilityState={{ disabled: current === 0 }}
            disabled={current === 0}
            onPress={() => session.goTo(current - 1)}
            style={[styles.navButton, current === 0 && styles.disabled]}
          >
            <ChevronLeft size={22} color={colors.brand700} />
            <AppText weight="semibold" color={colors.brand700}>
              {t("room:previous")}
            </AppText>
          </Pressable>
          {current < room.questions.length - 1 ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t("room:next")} onPress={() => session.goTo(current + 1)} style={[styles.navButton, styles.navPrimary]}>
              <AppText weight="semibold" color={colors.white}>
                {t("room:next")}
              </AppText>
              <ChevronRight size={22} color={colors.white} />
            </Pressable>
          ) : (
            <View style={styles.submitWrap}>
              <Button label={t("room:submit")} onPress={() => setConfirmSubmit(true)} disabled={!editable} loading={submitting} />
            </View>
          )}
        </View>
      </View>

      <Palette
        open={paletteOpen}
        questions={room.questions}
        answers={answers}
        current={current}
        canSubmit={editable}
        onPick={(index) => {
          session.goTo(index);
          setPaletteOpen(false);
        }}
        onSubmit={() => {
          setPaletteOpen(false);
          setConfirmSubmit(true);
        }}
        onClose={() => setPaletteOpen(false)}
      />
      <ConfirmDialog
        open={confirmSubmit}
        title={t("room:submitTitle")}
        body={t("room:submitBody", { answered: n(counts.answered), total: n(counts.total), unanswered: n(counts.unanswered), marked: n(counts.marked) })}
        confirmLabel={t("room:submitConfirm")}
        onConfirm={() => {
          setConfirmSubmit(false);
          void session.submit("manual");
        }}
        onCancel={() => setConfirmSubmit(false)}
      />
      <ConfirmDialog
        open={confirmLeave}
        title={t("room:leaveTitle")}
        body={t("room:leaveBody")}
        confirmLabel={t("room:leaveConfirm")}
        onConfirm={() => {
          setConfirmLeave(false);
          void session.flush();
          if (router.canGoBack()) router.back();
          else router.replace("/home");
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: "center", gap: space.md, marginTop: space.huge * 2 },
  header: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs },
  headerRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  headerTitle: { flex: 1 },
  iconButton: { width: touchTarget - 4, height: touchTarget - 4, alignItems: "center", justifyContent: "center", borderRadius: radius.control },
  statusRow: { flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingHorizontal: space.xs },
  sync: { flexShrink: 1, textAlign: "right" },
  content: { paddingHorizontal: space.lg, paddingVertical: space.xl },
  inner: { width: "100%", maxWidth: 640, alignSelf: "center", gap: space.lg },
  langRow: { flexDirection: "row", gap: space.sm },
  langChip: { paddingHorizontal: space.md, minHeight: 36, justifyContent: "center", borderRadius: radius.full, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  langChipOn: { borderColor: colors.brand600, backgroundColor: colors.brand50 },
  footer: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: space.lg, paddingVertical: space.md },
  footerInner: { flexDirection: "row", gap: space.md, width: "100%", maxWidth: 640, alignSelf: "center" },
  navButton: {
    flex: 1,
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  navPrimary: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  submitWrap: { flex: 1 },
  disabled: { opacity: 0.45 },
});
