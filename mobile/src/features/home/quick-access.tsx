import { router, type Href } from "expo-router";
import { CalendarClock, Package, Radio, Trophy, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { colors, radius, space } from "@/theme";

const LINKS: { key: string; href: Href; Icon: LucideIcon }[] = [
  { key: "upcoming", href: "/exams?when=upcoming", Icon: CalendarClock },
  { key: "open", href: "/exams?when=open", Icon: Radio },
  { key: "results", href: "/results", Icon: Trophy },
  { key: "packages", href: "/packages", Icon: Package },
];

/** Four one-tap shortcuts under the categories. */
export function QuickAccess() {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <AppText variant="lead" weight="bold" role="heading">
        {t("home:quick.title")}
      </AppText>
      <View style={styles.row}>
        {LINKS.map(({ key, href, Icon }) => (
          <Pressable
            key={key}
            accessibilityRole="link"
            onPress={() => router.push(href)}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
          >
            <View style={styles.icon}>
              <Icon size={20} color={colors.brand600} />
            </View>
            <AppText variant="caption" weight="semibold" align="center" numberOfLines={2}>
              {t(`home:quick.${key}`)}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  row: { flexDirection: "row", gap: space.sm },
  tile: {
    flex: 1,
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
    borderRadius: radius.sheet,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  icon: { width: 40, height: 40, borderRadius: radius.card, backgroundColor: colors.brand50, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.85 },
});
