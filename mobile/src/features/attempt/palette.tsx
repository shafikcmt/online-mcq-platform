import { Bookmark, X } from "lucide-react-native";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Button } from "@/components/button";
import { localizeDigits } from "@/lib/text";
import { colors, radius, space } from "@/theme";

import type { Answer } from "./session";
import type { RoomQuestion } from "./types";

type Props = {
  open: boolean;
  questions: RoomQuestion[];
  answers: Record<number, Answer>;
  current: number;
  canSubmit: boolean;
  onPick: (index: number) => void;
  onSubmit: () => void;
  onClose: () => void;
};

/** Every question at a glance: answered (filled), marked for review (bookmark), not
 * answered (plain), current (thick outline). Each tile also says its state in words. */
export function Palette({ open, questions, answers, current, canSubmit, onPick, onSubmit, onClose }: Props) {
  const { t, i18n } = useTranslation();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("close")} />
        <View style={styles.sheet} role="dialog" aria-modal accessibilityLabel={t("room:paletteTitle")}>
          <View style={styles.head}>
            <AppText variant="h4" weight="bold" role="heading" style={styles.title}>
              {t("room:paletteTitle")}
            </AppText>
            <Pressable accessibilityRole="button" accessibilityLabel={t("close")} onPress={onClose} hitSlop={8} style={styles.close}>
              <X size={22} color={colors.ink} />
            </Pressable>
          </View>
          <View style={styles.legend}>
            <Legend swatch={styles.tileAnswered} label={t("room:legend.answered")} />
            <Legend swatch={styles.tileMarked} label={t("room:legend.marked")} />
            <Legend swatch={styles.tile} label={t("room:legend.unanswered")} />
          </View>
          <ScrollView contentContainerStyle={styles.grid}>
            {questions.map((question, index) => {
              const answer = answers[question.question_id];
              const answered = answer?.selected != null;
              const marked = !!answer?.marked;
              const state = [
                answered ? t("room:legend.answered") : t("room:legend.unanswered"),
                marked ? t("room:legend.marked") : null,
                index === current ? t("room:legend.current") : null,
              ]
                .filter(Boolean)
                .join(", ");
              return (
                <Pressable
                  key={question.question_id}
                  accessibilityRole="button"
                  accessibilityLabel={t("room:paletteItem", { n: localizeDigits(question.number, i18n.language), state })}
                  onPress={() => onPick(index)}
                  style={[styles.tile, answered && styles.tileAnswered, marked && !answered && styles.tileMarked, index === current && styles.tileCurrent]}
                >
                  <AppText weight="bold" color={answered ? colors.white : colors.ink}>
                    {localizeDigits(question.number, i18n.language)}
                  </AppText>
                  {marked ? (
                    <View style={styles.flag}>
                      <Bookmark size={12} color={colors.warning700} fill={colors.accent500} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          {canSubmit ? <Button label={t("room:submit")} onPress={onSubmit} /> : null}
        </View>
      </View>
    </Modal>
  );
}

function Legend({ swatch, label }: { swatch: object; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, swatch]} />
      <AppText variant="caption" color={colors.inkMuted}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15, 23, 42, 0.45)" },
  sheet: {
    maxHeight: "80%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: space.xl,
    gap: space.lg,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  head: { flexDirection: "row", alignItems: "center" },
  title: { flex: 1 },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.lg },
  legendItem: { flexDirection: "row", alignItems: "center", gap: space.xs },
  swatch: { width: 16, height: 16, minWidth: 16, minHeight: 16, borderRadius: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingBottom: space.sm },
  tile: {
    width: 48,
    height: 48,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  tileAnswered: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  tileMarked: { backgroundColor: colors.warning50, borderColor: colors.warning700 },
  tileCurrent: { borderWidth: 3, borderColor: colors.brand950 },
  flag: { position: "absolute", top: 2, right: 2 },
});
