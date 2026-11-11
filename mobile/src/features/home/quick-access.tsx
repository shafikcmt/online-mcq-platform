import { router, type Href } from "expo-router";
import { Archive, CalendarClock, CalendarDays, Package, PlayCircle, Radio, Trophy, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { colors, radius, space } from "@/theme";

const LINKS: { key: string; href: Href; Icon: LucideIcon }[] = [
  { key: "upcoming", href: "/exams?when=upcoming", Icon: CalendarClock },
  { key: "open", href: "/exams?when=open", Icon: Radio },
  { key: "routine", href: "/routine", Icon: CalendarDays },
  { key: "materials", href: "/materials", Icon: PlayCircle },
  { key: "results", href: "/results", Icon: Trophy },
  { key: "archive", href: "/exams?when=ended", Icon: Archive },
  { key: "packages", href: "/packages", Icon: Package },
];
const PER_ROW = 4;
const ROWS = Array.from({ length: Math.ceil(LINKS.length / PER_ROW) }, (_, index) => LINKS.slice(index * PER_ROW, (index + 1) * PER_ROW));

/** One-tap shortcuts under the categories: exams (open, upcoming, past), the routine, study materials,
 * results and packages. Rows of four; the last row is padded so tiles keep one width. */
export function QuickAccess() {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <AppText variant="lead" weight="bold" role="heading">
        {t("home:quick.title")}
      </AppText>
      {ROWS.map((row, index) => (
        <View key={index} style={styles.row}>
          {row.map(({ key, href, Icon }) => (
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
          {Array.from({ length: PER_ROW - row.length }, (_, pad) => (
            <View key={`pad-${pad}`} style={styles.pad} />
          ))}
        </View>
      ))}
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
  pad: { flex: 1 },
  pressed: { opacity: 0.85 },
});
