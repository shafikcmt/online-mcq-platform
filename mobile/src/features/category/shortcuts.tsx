import { router, type Href } from "expo-router";
import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/app-text";
import { colors, radius, space } from "@/theme";

export type Shortcut = { key: string; label: string; href: Href; Icon: LucideIcon };

/** A row of round shortcut buttons with a label under each (the bar under a category's exams). */
export function ShortcutBar({ items }: { items: Shortcut[] }) {
  return (
    <View style={styles.bar}>
      {items.map(({ key, label, href, Icon }) => (
        <Pressable key={key} accessibilityRole="link" accessibilityLabel={label} onPress={() => router.push(href)} style={styles.barItem} hitSlop={4}>
          {({ pressed }) => (
            <>
              <View style={[styles.circle, pressed && styles.pressed]}>
                <Icon size={22} color={colors.brand700} />
              </View>
              <AppText variant="caption" weight="medium" color={colors.inkMuted} numberOfLines={1}>
                {label}
              </AppText>
            </>
          )}
        </Pressable>
      ))}
    </View>
  );
}

/** Two-per-row shortcut tiles (icon and label side by side), used on an exam's own screen. */
export function ShortcutGrid({ items }: { items: Shortcut[] }) {
  return (
    <View style={styles.grid}>
      {items.map(({ key, label, href, Icon }) => (
        <Pressable
          key={key}
          accessibilityRole="link"
          accessibilityLabel={label}
          onPress={() => router.push(href)}
          style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
        >
          <Icon size={22} color={colors.brand700} />
          <AppText weight="semibold" numberOfLines={1} style={styles.tileText}>
            {label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", justifyContent: "space-around", gap: space.xs },
  barItem: { flex: 1, alignItems: "center", gap: space.xs },
  circle: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    minHeight: 52,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  tileText: { flex: 1 },
  pressed: { backgroundColor: colors.brand50, borderColor: colors.brand600 },
});
