import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/app-text";
import { colors, radius, space } from "@/theme";

/** A titled block on Home: a brand-coloured band with the section name, then its tiles on a
 * white card. Used for the exam section and the study section so both read as one family. */
export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      <View style={styles.band}>
        <AppText variant="lead" weight="bold" color={colors.white} align="center" role="heading">
          {title}
        </AppText>
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

export const panelStyles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 56,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  tileText: { flex: 1 },
  pressed: { backgroundColor: colors.brand50, borderColor: colors.brand600 },
});

const styles = StyleSheet.create({
  panel: { borderRadius: radius.sheet, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  band: { backgroundColor: colors.brand600, paddingVertical: space.sm, paddingHorizontal: space.lg },
  body: { padding: space.md },
});
