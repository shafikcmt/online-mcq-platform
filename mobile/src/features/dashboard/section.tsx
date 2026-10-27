import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { localizeDigits } from "@/lib/text";
import { colors, radius, space } from "@/theme";

/** A titled block on Home. When the server has more than the short list it sent, says so
 * ("5 of 12") — the full lists come with the exam and result screens. */
export function Section({ title, count, shown, children }: { title: string; count: number; shown: number; children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const n = (value: number) => localizeDigits(value, i18n.language);
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <AppText variant="lead" weight="bold" role="heading" style={styles.title}>
          {title}
        </AppText>
        {count > shown ? (
          <AppText variant="small" color={colors.inkMuted}>
            {t("home:shownOf", { shown: n(shown), count: n(count) })}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** Quiet empty state inside a section. */
export function EmptyNote({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <AppText variant="small" color={colors.inkMuted} align="center">
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  header: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  title: { flex: 1 },
  empty: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.lineStrong,
    borderRadius: radius.card,
    padding: space.lg,
  },
});
