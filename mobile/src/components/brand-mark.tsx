import { ListChecks } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { colors, radius, space } from "@/theme";

import { AppText } from "./app-text";

/** Our own simple mark (icon + app name) — no third-party branding. */
export function BrandMark({ showName = true }: { showName?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      <View style={styles.tile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ListChecks size={30} color={colors.white} strokeWidth={2.25} />
      </View>
      {showName ? (
        <AppText variant="lead" weight="bold" color={colors.brand800}>
          {t("appName")}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: space.sm },
  tile: { width: 60, height: 60, borderRadius: radius.sheet, backgroundColor: colors.brand600, alignItems: "center", justifyContent: "center" },
});
