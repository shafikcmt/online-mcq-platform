import { Bookmark, BookmarkCheck, Check } from "lucide-react-native";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { formatDecimal } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { colors, radius, space, touchTarget } from "@/theme";

import { optionLetter } from "./format";
import type { Answer } from "./session";
import type { RoomQuestion } from "./types";

type Props = {
  question: RoomQuestion;
  total: number;
  answer: Answer;
  /** Content language shown (an exam in both languages can switch). */
  lang: "bn" | "en";
  negativeMarks: string;
  editable: boolean;
  onSelect: (optionId: number | null) => void;
  onToggleMark: () => void;
};

const textIn = (item: { text: string; text_bn?: string; text_en?: string }, lang: "bn" | "en") =>
  (lang === "bn" ? item.text_bn : item.text_en) || item.text;

/** One question: number, marks, text (and image), options as a radio group. Tapping the
 * chosen option again keeps it; "Clear answer" removes it. */
export function QuestionView({ question, total, answer, lang, negativeMarks, editable, onSelect, onToggleMark }: Props) {
  const { t, i18n } = useTranslation();
  const ui = i18n.language;
  const negative = Number(negativeMarks) > 0;
  return (
    <View style={styles.wrap}>
      <View style={styles.meta}>
        <AppText variant="small" weight="semibold" color={colors.brand700}>
          {t("room:question", { n: localizeDigits(question.number, ui), total: localizeDigits(total, ui) })}
        </AppText>
        <AppText variant="small" color={colors.inkMuted}>
          {t("room:marks", { marks: formatDecimal(question.marks, ui) })}
          {negative ? ` · ${t("room:negative", { value: formatDecimal(negativeMarks, ui) })}` : ""}
        </AppText>
      </View>
      <AppText variant="lead" weight="medium" lang={lang} role="heading">
        {textIn(question, lang)}
      </AppText>
      {question.image ? <Image source={{ uri: question.image }} style={styles.image} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
      <View style={styles.options} role="radiogroup" accessibilityLabel={t("room:options")}>
        {question.options.map((option, index) => {
          const selected = answer.selected === option.id;
          return (
            <Pressable
              key={option.id}
              role="radio"
              aria-checked={selected}
              accessibilityLabel={`${optionLetter(index, lang)}. ${textIn(option, lang)}`}
              accessibilityState={{ checked: selected, disabled: !editable }}
              disabled={!editable}
              onPress={() => onSelect(option.id)}
              style={({ pressed }) => [styles.option, selected && styles.selected, pressed && !selected && styles.pressed]}
            >
              <View style={[styles.letter, selected && styles.letterOn]}>
                {selected ? (
                  <Check size={16} color={colors.white} />
                ) : (
                  <AppText variant="small" weight="bold" color={colors.inkMuted}>
                    {optionLetter(index, lang)}
                  </AppText>
                )}
              </View>
              <AppText lang={lang} style={styles.optionText} weight={selected ? "semibold" : "regular"}>
                {textIn(option, lang)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.tools}>
        <Pressable
          role="checkbox"
          aria-checked={answer.marked}
          accessibilityState={{ checked: answer.marked, disabled: !editable }}
          disabled={!editable}
          onPress={onToggleMark}
          style={[styles.tool, answer.marked && styles.toolOn]}
        >
          {answer.marked ? <BookmarkCheck size={18} color={colors.warning700} /> : <Bookmark size={18} color={colors.inkMuted} />}
          <AppText variant="small" weight="semibold" color={answer.marked ? colors.warning700 : colors.inkMuted}>
            {t(answer.marked ? "room:marked" : "room:mark")}
          </AppText>
        </Pressable>
        {answer.selected !== null && editable ? (
          <Pressable accessibilityRole="button" onPress={() => onSelect(null)} style={styles.tool}>
            <AppText variant="small" weight="semibold" color={colors.brand700}>
              {t("room:clear")}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  meta: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space.sm },
  image: { width: "100%", height: 200, borderRadius: radius.card, backgroundColor: colors.surface },
  options: { gap: space.sm },
  option: {
    minHeight: touchTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.brand600, borderWidth: 2, backgroundColor: colors.brand50 },
  pressed: { backgroundColor: colors.canvas },
  letter: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  letterOn: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  optionText: { flex: 1 },
  tools: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tool: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  toolOn: { borderColor: colors.warning700 + "55", backgroundColor: colors.warning50 },
});
