import { Eye, EyeOff } from "lucide-react-native";
import { useState, type Ref } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from "react-native";
import { useTranslation } from "react-i18next";

import { colors, fontFamily, fontSize, radius, space, touchTarget } from "@/theme";

import { AppText } from "./app-text";

export type TextFieldProps = Omit<TextInputProps, "style" | "ref"> & {
  ref?: Ref<TextInputInstance>;
  label: string;
  hint?: string;
  error?: string;
  optionalLabel?: string;
  prefix?: string;
  /** Password field with a show/hide toggle. */
  secret?: boolean;
};

/** Label above, hint/error below (the error replaces the hint and is announced). The
 * input's accessible name is the label. */
export function TextField({ ref, label, hint, error, optionalLabel, prefix, secret, editable = true, onFocus, onBlur, ...rest }: TextFieldProps) {
  const { t, i18n } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const bengali = i18n.language === "bn";
  const borderColor = error ? colors.danger700 : focused ? colors.brand600 : colors.lineStrong;
  return (
    <View style={styles.wrap}>
      <AppText variant="small" weight="medium" color={colors.ink}>
        {label}
        {optionalLabel ? <AppText variant="small" color={colors.inkSubtle}>{` (${optionalLabel})`}</AppText> : null}
      </AppText>
      <View style={[styles.box, { borderColor, borderWidth: focused || error ? 2 : 1 }, !editable && styles.disabled]}>
        {prefix ? (
          <AppText color={colors.inkMuted} style={styles.prefix} lang="en">
            {prefix}
          </AppText>
        ) : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          aria-invalid={error ? true : undefined}
          editable={editable}
          placeholderTextColor={colors.inkSubtle}
          {...rest}
          secureTextEntry={secret && !shown}
          autoCapitalize={secret ? "none" : rest.autoCapitalize}
          autoCorrect={secret ? false : rest.autoCorrect}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, { fontFamily: fontFamily[bengali ? "bengali" : "latin"].regular }]}
        />
        {secret ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? t("auth:hidePassword") : t("auth:showPassword")}
            onPress={() => setShown((value) => !value)}
            hitSlop={8}
            style={styles.toggle}
          >
            {shown ? <EyeOff size={20} color={colors.inkMuted} /> : <Eye size={20} color={colors.inkMuted} />}
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <AppText variant="small" color={colors.danger700} accessibilityLiveRegion="polite" role="alert">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="small" color={colors.inkSubtle}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs + 2 },
  box: {
    minHeight: touchTarget + 2,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.md,
  },
  disabled: { backgroundColor: colors.canvas },
  prefix: { marginRight: space.sm, paddingRight: space.sm, borderRightWidth: 1, borderRightColor: colors.line },
  input: { flex: 1, fontSize: fontSize.body, color: colors.ink, paddingVertical: space.sm, minHeight: touchTarget },
  toggle: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
