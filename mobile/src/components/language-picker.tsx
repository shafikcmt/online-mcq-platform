import { Check } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { LANGUAGES, type Language } from "@/i18n";
import { colors, radius, space, touchTarget } from "@/theme";

import { AppText } from "./app-text";

/** Two large choices, each written in its own language. A radio group for screen readers. */
export function LanguagePicker({ value, onChange, disabled }: { value: Language | null; onChange: (language: Language) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.group} role="radiogroup" accessibilityLabel={t("language.title")}>
      {LANGUAGES.map((language) => {
        const selected = value === language;
        return (
          <Pressable
            key={language}
            role="radio"
            accessibilityState={{ checked: selected, disabled }}
            aria-checked={selected}
            disabled={disabled}
            onPress={() => onChange(language)}
            style={({ pressed }) => [
              styles.option,
              selected && styles.selected,
              pressed && !selected && { backgroundColor: colors.brand50 },
            ]}
          >
            <AppText variant="lead" weight="semibold" lang={language} color={selected ? colors.brand700 : colors.ink} style={styles.label}>
              {t(`language.${language}`)}
            </AppText>
            {selected ? <Check size={22} color={colors.brand700} /> : <View style={styles.dot} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.md },
  option: {
    minHeight: touchTarget + 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    paddingHorizontal: space.xl,
  },
  selected: { borderColor: colors.brand600, borderWidth: 2, backgroundColor: colors.brand50 },
  label: { flex: 1 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.lineStrong },
});
