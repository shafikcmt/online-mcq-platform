import { Image, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { colors, radius, space, touchTarget } from "@/theme";

import { logoUri } from "./methods";
import type { PaymentMethod } from "./types";

function Body({ method, active }: { method: PaymentMethod; active: boolean }) {
  const { t } = useTranslation();
  const logo = logoUri(method.logo_url);
  return (
    <>
      {logo ? <Image source={{ uri: logo }} style={styles.logo} accessibilityIgnoresInvertColors /> : null}
      <View style={styles.text}>
        <View style={styles.nameRow}>
          <AppText weight={active ? "semibold" : "regular"}>{method.name}</AppText>
          {method.is_test ? (
            <View style={styles.badge}>
              <AppText variant="caption" weight="semibold" color={colors.warning700}>
                {t("packages:testBadge")}
              </AppText>
            </View>
          ) : null}
        </View>
        {method.description ? (
          <AppText variant="small" color={colors.inkMuted}>
            {method.description}
          </AppText>
        ) : null}
      </View>
    </>
  );
}

/** "Pay with": the methods the server offers for this package, in the app. One method is shown
 * as a plain row (it is still sent, so the right merchant account is used); several are radio
 * choices. `selected` is a gateway identifier. */
export function MethodChoice({ methods, selected, onSelect }: { methods: PaymentMethod[]; selected: string; onSelect: (gateway: string) => void }) {
  const { t } = useTranslation();
  if (methods.length === 0) return null;
  const hasTest = methods.some((method) => method.is_test);
  return (
    <View style={styles.group} accessibilityRole={methods.length > 1 ? "radiogroup" : undefined} accessibilityLabel={t("packages:payWith")}>
      <AppText variant="small" weight="semibold">
        {t("packages:payWith")}
      </AppText>
      {methods.length === 1 ? (
        <View style={styles.row} accessible accessibilityLabel={methods[0].name}>
          <Body method={methods[0]} active />
        </View>
      ) : (
        methods.map((method) => {
          const active = method.gateway === selected;
          return (
            <Pressable
              key={method.gateway}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={method.name}
              onPress={() => onSelect(method.gateway)}
              style={[styles.row, active && styles.rowActive]}
            >
              <View style={[styles.dot, active && styles.dotActive]} />
              <Body method={method} active={active} />
            </Pressable>
          );
        })
      )}
      {hasTest ? (
        <AppText variant="caption" color={colors.warning700}>
          {t("packages:testNote")}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  row: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.control, borderWidth: 1, borderColor: colors.line },
  rowActive: { borderColor: colors.brand600, backgroundColor: colors.brand50 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.line },
  dotActive: { borderColor: colors.brand600, backgroundColor: colors.brand600 },
  logo: { width: 32, height: 32, borderRadius: radius.control, backgroundColor: colors.surface },
  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  badge: { paddingHorizontal: space.sm, paddingVertical: 1, borderRadius: radius.control, backgroundColor: colors.warning50 },
});
