import { useLocalSearchParams } from "expo-router";
import { Check, CloudOff, Lock, X } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { isApiError } from "@/api/errors";
import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { Segmented } from "@/components/segmented";
import { optionLetter } from "@/features/attempt/format";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchReview } from "@/features/results/api";
import type { ReviewQuestion } from "@/features/results/types";
import { formatDecimal } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { colors, radius, space } from "@/theme";

type Filter = "all" | "wrong" | "unanswered" | "correct";
const FILTERS: Filter[] = ["all", "wrong", "unanswered", "correct"];

const textIn = (item: { text: string; text_bn?: string; text_en?: string }, lang: "bn" | "en") => (lang === "bn" ? item.text_bn : item.text_en) || item.text;
const explanationIn = (q: ReviewQuestion, lang: "bn" | "en") => (lang === "bn" ? q.explanation_bn : q.explanation_en) || q.explanation;

function stateOf(question: ReviewQuestion): Exclude<Filter, "all"> {
  if (question.selected_option_id === null) return "unanswered";
  return question.is_correct ? "correct" : "wrong";
}

/** Every question with the student's answer, the correct answer and the explanation —
 * only after submission, only when the server allows it (results visible and the exam
 * allows review); otherwise the server refuses and this screen says why. */
export default function ReviewScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => fetchReview(id), [id]);
  const { data, error, loading, retry } = useRemote(load);
  const [filter, setFilter] = useState<Filter>("all");
  const bilingual = !!data?.questions.some((q) => q.text_bn !== undefined);
  const [lang, setLang] = useState<"bn" | "en">(i18n.language === "en" ? "en" : "bn");
  const refused = isApiError(error) && error.status === 403;
  const shown = data ? data.questions.filter((q) => filter === "all" || stateOf(q) === filter) : [];
  const counts = data ? Object.fromEntries(FILTERS.map((f) => [f, f === "all" ? data.questions.length : data.questions.filter((q) => stateOf(q) === f).length])) : {};

  return (
    <Screen>
      <PageHeader title={data?.result.exam.title ?? t("results:review.title")} eyebrow={t("results:review.title")} />
      {loading ? <View style={styles.block} accessible accessibilityLabel={t("loading")} accessibilityState={{ busy: true }} /> : null}
      {!data && refused ? (
        <View style={styles.center}>
          <Lock size={36} color={colors.inkSubtle} />
          <AppText color={colors.inkMuted} align="center">
            {error.code === "review_not_allowed" ? t("results:review.notAllowed") : t("results:detail.notVisible")}
          </AppText>
        </View>
      ) : null}
      {!data && error && !refused ? (
        <View style={styles.center}>
          <CloudOff size={36} color={colors.inkSubtle} />
          <AppText color={colors.inkMuted} align="center" role="alert">
            {describeError(error, t)}
          </AppText>
          <Button label={t("retry")} variant="secondary" onPress={retry} />
        </View>
      ) : null}
      {data ? (
        <>
          <Segmented
            label={t("results:review.filters.label")}
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((value) => ({ value, label: `${t(`results:review.filters.${value}`)} (${localizeDigits(counts[value] ?? 0, i18n.language)})` }))}
          />
          {bilingual ? (
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
          {shown.length ? shown.map((question) => <QuestionReview key={question.question_id} question={question} lang={bilingual ? lang : undefined} />) : <EmptyNote text={t("results:review.none")} />}
        </>
      ) : null}
    </Screen>
  );
}

function QuestionReview({ question, lang }: { question: ReviewQuestion; lang?: "bn" | "en" }) {
  const { t, i18n } = useTranslation();
  const ui = i18n.language;
  const shownLang = lang ?? (ui === "en" ? "en" : "bn");
  const state = stateOf(question);
  const tone = state === "correct" ? "success" : state === "wrong" ? "danger" : "neutral";
  const explanation = explanationIn(question, shownLang);
  return (
    <Card style={styles.question}>
      <View style={styles.qHead}>
        <AppText variant="small" weight="semibold" color={colors.brand700} style={styles.qNumber}>
          {t("results:review.question", { n: localizeDigits(question.number, ui) })}
        </AppText>
        <Badge label={t(`results:review.${state}`)} tone={tone} />
      </View>
      <AppText weight="medium" lang={lang}>
        {textIn(question, shownLang)}
      </AppText>
      {question.image ? <Image source={{ uri: question.image }} style={styles.image} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
      <View style={styles.options}>
        {question.options.map((option, index) => {
          const chosen = option.id === question.selected_option_id;
          const right = option.is_correct;
          const label = [
            `${optionLetter(index, shownLang)}. ${textIn(option, shownLang)}`,
            right ? t("results:review.correctAnswer") : null,
            chosen ? t("results:review.yourAnswer") : null,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <View key={option.id} accessible accessibilityLabel={label} style={[styles.option, right && styles.optionRight, chosen && !right && styles.optionWrong]}>
              <View style={[styles.mark, right && styles.markRight, chosen && !right && styles.markWrong]}>
                {right ? <Check size={14} color={colors.white} /> : chosen ? <X size={14} color={colors.white} /> : (
                  <AppText variant="caption" weight="bold" color={colors.inkMuted}>
                    {optionLetter(index, shownLang)}
                  </AppText>
                )}
              </View>
              <View style={styles.optionBody}>
                <AppText variant="small" lang={lang} weight={right || chosen ? "semibold" : "regular"}>
                  {textIn(option, shownLang)}
                </AppText>
                {chosen ? (
                  <AppText variant="caption" color={right ? colors.success700 : colors.danger700}>
                    {t("results:review.yourAnswer")}
                  </AppText>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
      <AppText variant="small" color={colors.inkMuted}>
        {t("results:review.awarded", { awarded: formatDecimal(question.awarded_marks, ui), marks: formatDecimal(question.marks, ui) })}
      </AppText>
      {explanation ? (
        <View style={styles.explanation}>
          <AppText variant="small" weight="bold">
            {t("results:review.explanation")}
          </AppText>
          <AppText variant="small" lang={lang}>
            {explanation}
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  block: { height: 220, borderRadius: radius.card, backgroundColor: colors.line },
  center: { alignItems: "center", gap: space.md, marginTop: space.huge },
  langRow: { flexDirection: "row", gap: space.sm },
  langChip: { paddingHorizontal: space.md, minHeight: 36, justifyContent: "center", borderRadius: radius.full, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  langChipOn: { borderColor: colors.brand600, backgroundColor: colors.brand50 },
  question: { gap: space.md },
  qHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  qNumber: { flex: 1 },
  image: { width: "100%", height: 180, borderRadius: radius.control },
  options: { gap: space.xs },
  option: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm, borderRadius: radius.control, borderWidth: 1, borderColor: colors.line },
  optionRight: { borderColor: colors.success700 + "66", backgroundColor: colors.success50 },
  optionWrong: { borderColor: colors.danger700 + "66", backgroundColor: colors.danger50 },
  mark: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  markRight: { backgroundColor: colors.success700, borderColor: colors.success700 },
  markWrong: { backgroundColor: colors.danger700, borderColor: colors.danger700 },
  optionBody: { flex: 1, gap: 2 },
  explanation: { gap: space.xs, padding: space.md, borderRadius: radius.control, backgroundColor: colors.info50 },
});
