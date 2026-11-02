import { Image, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

const MARK = require("../../assets/images/logo-mark.png");
const LOCKUP = require("../../assets/images/logo-lockup.png");

/** The official Live Model Test logo ("Rank Signal" brand kit — the same artwork as the
 * Website, the Admin Panel and the app icon). With the name: the vertical lockup (icon +
 * "LIVE MODEL TEST" in one image); without: the icon alone. */
export function BrandMark({ showName = true }: { showName?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap} accessible accessibilityRole="image" accessibilityLabel={t("appName")}>
      {showName ? (
        <Image source={LOCKUP} style={styles.lockup} resizeMode="contain" accessibilityIgnoresInvertColors />
      ) : (
        <Image source={MARK} style={styles.mark} accessibilityIgnoresInvertColors />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
  mark: { width: 72, height: 72 },
  // Vertical lockup, cropped to the artwork (524:747).
  lockup: { width: 112, height: 160 },
});
