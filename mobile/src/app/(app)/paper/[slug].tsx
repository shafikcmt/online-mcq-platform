import { useLocalSearchParams } from "expo-router";
import { Check, CloudOff, Eye, EyeOff, Lock } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { isApiError } from "@/api/errors";
import { AppText } from "@/components/app-text";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { optionLetter } from "@/features/attempt/format";
import { fetchExamPaper } from "@/features/exams/api";
import type { PaperQuestion } from "@/features/exams/types";
import { formatDecimal } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { colors, radius, space } from "@/theme";

const textIn = (item: { text: string; text_bn?: string; text_en?: string }, lang: "bn" | "en") => (lang === "bn" ? item.text_bn : item.text_en) || item.text;

/** The archive: the questions of an exam that is over, for any student who may see the exam (also
 * one who never took it). Answers and explanations stay hidden until "Show answers" is pressed, so
 * the paper can be used to practise first. The server decides whether the paper may be read at all
 * (the exam is over, answer review is allowed, results are visible, a paid exam is covered). */
export default function PaperScreen() {
  const { t, i18n } = useTranslation();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const load = useCallback(() => fetchExamPaper(slug), [slug]);
  const { data, error, loading, retry } = useRemote(load);
  const [answers, setAnswers] = useState(false);
  const bilingual = !!data?.questions.some((question) => question.text_bn !== undefined);
  const [lang, setLang] = useState<"bn" | "en">(i18n.language === "en" ? "en" : "bn");
  const refused = isApiError(error) && error.status === 403;

  return (
    <Screen>
      <PageHeader
        title={data?.title ?? t("exams:paper.title")}
        eyebrow={t("exams:paper.title")}
        subtitle={data ? t("exams:paper.count", { count: data.total_questions, n: localizeDigits(data.total_questions, i18n.language) }) : undefined}
      />
      {loading ? <View style={styles.block} accessible accessibilityLabel={t("loading")} accessibilityState={{ busy: true }} /> : null}
      {!data && refused ? (
        <View style={styles.center}>
          <Lock size={36} color={colors.inkSubtle} />
          <AppText color={colors.inkMuted} align="center">
            {t("exams:paper.notAvailable")}
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
          <View style={styles.tools}>
            <Button
              label={t(answers ? "exams:paper.hide" : "exams:paper.show")}
              variant={answers ? "secondary" : "primary"}
              compact
              accessibilityState={{ expanded: answers }}
              onPress={() => setAnswers(!answers)}
              icon={answers ? <EyeOff size={18} color={colors.brand700} /> : <Eye size={18} color={colors.white} />}
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
          </View>
          {data.questions.map((question) => (
            <PaperQuestionCard key={question.question_id} question={question} lang={bilingual ? lang : undefined} answers={answers} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function PaperQuestionCard({ question, lang, answers }: { question: PaperQuestion; lang?: "bn" | "en"; answers: boolean }) {
  const { t, i18n } = useTranslation();
  const ui = i18n.language;
  const shownLang = lang ?? (ui === "en" ? "en" : "bn");
  const explanation = (shownLang === "bn" ? question.explanation_bn : question.explanation_en) || question.explanation;
  return (
    <Card style={styles.question}>
      <View style={styles.qHead}>
        <AppText variant="small" weight="semibold" color={colors.brand700} style={styles.qNumber}>
          {t("results:review.question", { n: localizeDigits(question.number, ui) })}
        </AppText>
        <AppText variant="caption" color={colors.inkMuted}>
          {t("exams:paper.marks", { n: formatDecimal(question.marks, ui) })}
        </AppText>
      </View>
      <AppText weight="medium" lang={lang}>
        {textIn(question, shownLang)}
      </AppText>
      {question.image ? <Image source={{ uri: question.image }} style={styles.image} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
      <View style={styles.options}>
        {question.options.map((option, index) => {
          const right = answers && option.is_correct;
          const text = textIn(option, shownLang);
          return (
            <View
              key={option.id}
              accessible
              accessibilityLabel={[`${optionLetter(index, shownLang)}. ${text}`, right ? t("results:review.correctAnswer") : null].filter(Boolean).join(", ")}
              style={[styles.option, right && styles.optionRight]}
            >
              <View style={[styles.mark, right && styles.markRight]}>
                {right ? (
                  <Check size={14} color={colors.white} />
                ) : (
                  <AppText variant="caption" weight="bold" color={colors.inkMuted}>
                    {optionLetter(index, shownLang)}
                  </AppText>
                )}
              </View>
              <AppText variant="small" lang={lang} weight={right ? "semibold" : "regular"} style={styles.optionBody}>
                {text}
              </AppText>
            </View>
          );
        })}
      </View>
      {answers && explanation ? (
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
  tools: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.md },
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
  mark: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  markRight: { backgroundColor: colors.success700, borderColor: colors.success700 },
  optionBody: { flex: 1 },
  explanation: { gap: space.xs, padding: space.md, borderRadius: radius.control, backgroundColor: colors.info50 },
});
