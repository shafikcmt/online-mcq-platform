import { router } from "expo-router";
import { ChevronRight, FolderOpen } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { localizeDigits, tidyName } from "@/lib/text";
import { colors, radius, space } from "@/theme";

import type { Group } from "./groups";

/** One shelf of a category or group as a full-width row: an icon, the name (two lines at most), a
 * quiet line with the exam count (and sub-group count), a red dot and "Live" when a scheduled exam
 * in it is running now, and a chevron. Opens the group's own screen. */
export function GroupRow({ group }: { group: Group }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const name = tidyName(group.name);
  const live = group.live_count > 0;
  const exams = t("category:groupExams", { count: group.exam_count, n: localizeDigits(group.exam_count, language) });
  const subs = group.child_count > 0 ? t("category:subGroups", { count: group.child_count, n: localizeDigits(group.child_count, language) }) : null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[name, exams, subs, live ? t("category:live") : null].filter(Boolean).join(", ")}
      onPress={() => router.push({ pathname: "/group/[slug]", params: { slug: group.slug, name } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <FolderOpen size={22} color={colors.brand700} />
      </View>
      <View style={styles.text}>
        <AppText weight="semibold" numberOfLines={2}>
          {name}
        </AppText>
        <View style={styles.meta}>
          <AppText variant="caption" color={colors.inkMuted}>
            {[exams, subs].filter(Boolean).join(" · ")}
          </AppText>
          {live ? (
            <View style={styles.live} testID={`live-${group.slug}`}>
              <View style={styles.dot} />
              <AppText variant="caption" weight="bold" color={colors.danger700}>
                {t("category:live")}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
      <ChevronRight size={18} color={colors.inkSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.sheet,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  pressed: { backgroundColor: colors.brand50, borderColor: colors.brand600 },
  icon: { width: 44, height: 44, borderRadius: radius.card, backgroundColor: colors.brand50, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.sm },
  live: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.danger700 },
});
