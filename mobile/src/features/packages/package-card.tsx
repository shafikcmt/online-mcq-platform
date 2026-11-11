import { Check, Star } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { formatDate } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { colors, radius, space } from "@/theme";

import { formatMoney } from "./money";
import type { Package } from "./types";

/** One package: price and validity from the server, features, and the student's own
 * subscription to it (then "Extend" instead of "Buy"). */
export function PackageCard({ pkg, busy, onBuy }: { pkg: Package; busy: boolean; onBuy: () => void }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const days = t("packages:validity", { count: pkg.validity_days, n: localizeDigits(pkg.validity_days, language) });
  const sub = pkg.subscription;
  const { scope, exam_count: examCount, categories } = pkg.access;
  const coverage =
    scope === "all"
      ? t("packages:coverAll", { n: localizeDigits(examCount, language) })
      : categories.length
        ? t("packages:coverSome", { count: examCount, n: localizeDigits(examCount, language), names: categories.map((category) => category.name).join(", ") })
        : "";
  return (
    <View style={[styles.card, pkg.is_featured && styles.featured]}>
      <View style={styles.head}>
        <AppText variant="lead" weight="bold" style={styles.name} role="heading">
          {pkg.name}
        </AppText>
        {pkg.is_featured ? <Badge label={t("packages:featured")} tone="brand" icon={<Star size={12} color={colors.brand700} />} /> : null}
      </View>
      <View style={styles.priceRow}>
        <AppText variant="h3" weight="bold" color={colors.brand800}>
          {formatMoney(pkg.price, pkg.currency, language)}
        </AppText>
        <AppText color={colors.inkMuted}>/ {days}</AppText>
      </View>
      {coverage ? (
        <View style={styles.coverage}>
          <AppText variant="small" weight="semibold" color={colors.brand800}>
            {coverage}
          </AppText>
        </View>
      ) : null}
      {pkg.description ? <AppText color={colors.inkMuted}>{pkg.description}</AppText> : null}
      {pkg.features.length ? (
        <View style={styles.features}>
          {pkg.features.map((feature) => (
            <View key={feature} style={styles.feature}>
              <Check size={16} color={colors.success700} style={styles.tick} />
              <AppText variant="small" style={styles.featureText}>
                {feature}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
      {sub ? (
        <Badge
          label={t(sub.active_now ? "packages:activeUntil" : "packages:scheduledUntil", { date: formatDate(sub.expires_at, language) })}
          tone={sub.active_now ? "success" : "info"}
        />
      ) : null}
      <Button label={t(sub ? "packages:extend" : "packages:buy")} variant={sub ? "secondary" : "primary"} onPress={onBuy} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  featured: { borderColor: colors.brand600, borderWidth: 2 },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { flex: 1 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: space.xs, flexWrap: "wrap" },
  coverage: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.control, backgroundColor: colors.brand50 },
  features: { gap: space.xs },
  feature: { flexDirection: "row", gap: space.sm },
  tick: { marginTop: 3 },
  featureText: { flex: 1 },
});
