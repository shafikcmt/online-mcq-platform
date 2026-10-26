import { Sparkles } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/auth/provider";
import { AppText } from "@/components/app-text";
import { Card } from "@/components/card";
import { Screen } from "@/components/screen";
import { colors, space } from "@/theme";

/** Home. The dashboard (exams, subscription, results — `GET /me/dashboard/`) is the next
 * Mobile App slice; for now a greeting and what is coming. */
export default function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const name = user?.display_name || user?.full_name.split(" ")[0] || "";
  return (
    <Screen edges={["top"]}>
      <View style={styles.header}>
        <AppText variant="h3" weight="bold" role="heading">
          {t("home:greeting", { name })}
        </AppText>
        <AppText color={colors.inkMuted}>{t("home:subtitle")}</AppText>
      </View>
      <Card style={styles.card}>
        <View style={styles.icon}>
          <Sparkles size={22} color={colors.brand700} />
        </View>
        <View style={styles.text}>
          <AppText weight="semibold">{t("home:comingTitle")}</AppText>
          <AppText variant="small" color={colors.inkMuted}>
            {t("home:comingBody")}
          </AppText>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  card: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand50, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: space.xs },
});
