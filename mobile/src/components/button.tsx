import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from "react-native";

import { colors, radius, space, touchTarget } from "@/theme";

import { AppText } from "./app-text";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const TONE: Record<Variant, { bg: string; pressed: string; text: string; border: string }> = {
  primary: { bg: colors.brand600, pressed: colors.brand700, text: colors.white, border: colors.brand600 },
  secondary: { bg: colors.surface, pressed: colors.brand50, text: colors.brand700, border: colors.lineStrong },
  ghost: { bg: "transparent", pressed: colors.brand50, text: colors.brand700, border: "transparent" },
  danger: { bg: colors.danger700, pressed: "#991B1B", text: colors.white, border: colors.danger700 },
};

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: Variant;
  loading?: boolean;
  icon?: React.ReactNode;
  compact?: boolean;
};

/** One primary action per screen; disabled + spinner while busy, so a double tap cannot
 * submit twice. Minimum 48 dp tall. */
export function Button({ label, variant = "primary", loading = false, disabled, icon, compact, ...rest }: ButtonProps) {
  const tone = TONE[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: pressed ? tone.pressed : tone.bg, borderColor: tone.border, opacity: inactive && !loading ? 0.55 : 1 },
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator size="small" color={tone.text} /> : icon}
        <AppText weight="semibold" color={tone.text} align="center">
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    justifyContent: "center",
  },
  compact: { paddingHorizontal: space.md, alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
});
