import { StyleSheet, View, type ViewProps } from "react-native";

import { colors, radius, space } from "@/theme";

/** Flat card: 1px border, no shadow (UI_UX_GUIDELINES §2.3). */
export function Card({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.card, style]} />;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: space.lg },
});
