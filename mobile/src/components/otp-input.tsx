import type { RefObject } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from "react-native";

import { toWesternDigits } from "@/lib/text";
import { colors, fontFamily, radius, space } from "@/theme";

import { AppText } from "./app-text";

type Props = {
  ref?: RefObject<TextInputInstance | null>;
  value: string;
  onChange: (value: string) => void;
  label: string;
  length?: number;
  error?: string;
  editable?: boolean;
  onComplete?: (value: string) => void;
};

/** 6 boxes backed by ONE real input: typing, pasting and Android's SMS autofill all work,
 * and screen readers see a single field named by `label`. Bangla digits are accepted and
 * converted. */
export function OtpInput({ ref, value, onChange, label, length = 6, error, editable = true, onComplete }: Props) {
  const digits = value.split("");
  return (
    <View style={styles.wrap}>
      <Pressable
        accessible={false}
        onPress={() => ref?.current?.focus()}
        style={styles.row}
      >
        {Array.from({ length }, (_, index) => {
          const active = index === Math.min(value.length, length - 1);
          return (
            <View
              key={index}
              style={[styles.box, { borderColor: error ? colors.danger700 : active ? colors.brand600 : colors.lineStrong, borderWidth: active || error ? 2 : 1 }]}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              <AppText variant="h3" weight="semibold" lang="en" style={styles.digit}>
                {digits[index] ?? ""}
              </AppText>
            </View>
          );
        })}
      </Pressable>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(text) => {
          const next = toWesternDigits(text).replace(/\D/g, "").slice(0, length);
          onChange(next);
          if (next.length === length) onComplete?.(next);
        }}
        accessibilityLabel={label}
        accessibilityHint={error}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length * 2}
        editable={editable}
        caretHidden
        style={styles.hidden}
      />
      {error ? (
        <AppText variant="small" color={colors.danger700} accessibilityLiveRegion="polite" role="alert">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: "row", gap: space.sm, justifyContent: "space-between" },
  box: {
    flex: 1,
    maxWidth: 56,
    aspectRatio: 0.85,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  digit: { fontFamily: fontFamily.latin.semibold, fontVariant: ["tabular-nums"] },
  // Covers the boxes, fully transparent: taps reach the real input, which stays focusable.
  hidden: { position: "absolute", top: 0, left: 0, right: 0, height: 64, opacity: 0.011, color: "transparent" },
});
