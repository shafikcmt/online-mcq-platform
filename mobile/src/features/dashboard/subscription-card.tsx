import { PackageCheck, PackageOpen } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Card } from "@/components/card";
import { formatDate } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { colors, space } from "@/theme";

import type { Dashboard } from "./types";

/** Active packages (soonest to expire first) or a plain "no package" note. */
export function SubscriptionCard({ subscription }: { subscription: Dashboard["subscription"] }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const active = subscription.active_count > 0;
  const Icon = active ? PackageCheck : PackageOpen;
  const more = subscription.active_count - subscription.items.length;
  return (
    <Card style={styles.card}>
      <View style={[styles.icon, { backgroundColor: active ? colors.success50 : colors.canvas }]}>
        <Icon size={22} color={active ? colors.success700 : colors.inkSubtle} />
      </View>
      <View style={styles.body}>
        <AppText weight="semibold" role="heading">
          {t(active ? "home:subscription.activeTitle" : "home:subscription.noneTitle")}
        </AppText>
        {active ? (
          subscription.items.map((item) => (
            <View key={`${item.package.slug}-${item.expires_at}`}>
              <AppText>{item.package.name}</AppText>
              <AppText variant="small" color={colors.inkMuted}>
                {t("home:subscription.validUntil", { date: formatDate(item.expires_at, language) })}
              </AppText>
            </View>
          ))
        ) : (
          <AppText variant="small" color={colors.inkMuted}>
            {t("home:subscription.noneBody")}
          </AppText>
        )}
        {more > 0 ? (
          <AppText variant="small" color={colors.inkMuted}>
            {t("home:subscription.more", { n: localizeDigits(more, language) })}
          </AppText>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: space.sm },
});
