import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { colors, radius, space, touchTarget } from "@/theme";

import type { PaymentMethod } from "./types";

/** "Pay with": one row per offered payment method, one selected. Shown only when the server
 * offers more than one; with a single method the server's default is used and nothing is shown. */
export function MethodChoice({ methods, selected, onSelect }: { methods: PaymentMethod[]; selected: string; onSelect: (provider: string) => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={t("packages:payWith")}>
      <AppText variant="small" weight="semibold">
        {t("packages:payWith")}
      </AppText>
      {methods.map((method) => {
        const active = method.provider === selected;
        return (
          <Pressable
            key={method.provider}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={method.label}
            onPress={() => onSelect(method.provider)}
            style={[styles.row, active && styles.rowActive]}
          >
            <View style={[styles.dot, active && styles.dotActive]} />
            <AppText weight={active ? "semibold" : "regular"}>{method.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  row: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.line },
  rowActive: { borderColor: colors.brand600, backgroundColor: colors.brand50 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.line },
  dotActive: { borderColor: colors.brand600, backgroundColor: colors.brand600 },
});
