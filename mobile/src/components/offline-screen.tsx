import { WifiOff } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/auth/provider";
import { colors, space } from "@/theme";

import { AppText } from "./app-text";
import { Button } from "./button";
import { Screen } from "./screen";

/** A stored session could not be checked (no internet / server down). The session is kept;
 * "Try again" re-runs the start-up check. */
export function OfflineScreen() {
  const { t } = useTranslation();
  const { retry } = useAuth();
  return (
    <Screen>
      <View style={styles.box}>
        <WifiOff size={40} color={colors.inkSubtle} />
        <AppText variant="h4" weight="bold" align="center" role="heading">
          {t("boot.offlineTitle")}
        </AppText>
        <AppText color={colors.inkMuted} align="center">
          {t("boot.offlineBody")}
        </AppText>
        <Button label={t("retry")} onPress={retry} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", gap: space.md, marginTop: space.huge * 2 },
});
