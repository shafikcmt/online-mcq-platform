import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/app-text";
import { BrandMark } from "@/components/brand-mark";
import { LanguagePicker } from "@/components/language-picker";
import { Screen } from "@/components/screen";
import { useLanguage } from "@/i18n/provider";
import { colors, space } from "@/theme";

/** First launch only: pick বাংলা or English (asked in the phone's language when it is one of them).
 * Choosing saves it; the root layout then moves on to sign-in. */
export default function LanguageScreen() {
  const { t } = useTranslation();
  const { setLanguage } = useLanguage();
  return (
    <Screen>
      <View style={styles.hero}>
        <BrandMark />
        <AppText variant="h3" weight="bold" align="center" role="heading">
          {t("language.title")}
        </AppText>
        <AppText color={colors.inkMuted} align="center">
          {t("language.subtitle")}
        </AppText>
      </View>
      <LanguagePicker value={null} onChange={(language) => void setLanguage(language)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: space.md, marginTop: space.huge, marginBottom: space.lg },
});
