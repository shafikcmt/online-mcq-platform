import { Image, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { colors, space } from "@/theme";

import { AppText } from "./app-text";

const LOGO = require("../../assets/images/logo-mark.png");

/** The Live Model Test logo mark + name (the same mark as the Admin Panel and app icon). */
export function BrandMark({ showName = true }: { showName?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      <Image source={LOGO} style={styles.logo} accessibilityIgnoresInvertColors accessible={false} />
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
  logo: { width: 72, height: 72 },
});
