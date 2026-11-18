import { router } from "expo-router";
import { BookOpenCheck, Briefcase, Building2, GraduationCap, Landmark, Stethoscope, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { localizeDigits, tidyName } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { colors, radius } from "@/theme";

import { fetchCategories } from "./api";
import { Panel, panelStyles } from "./panel";

/** Neutral icons in turn (categories are admin-defined, so no icon is tied to a name). */
const ICONS: LucideIcon[] = [GraduationCap, Stethoscope, BookOpenCheck, Landmark, Building2, Briefcase];

/** The exam section of Home: every category that has exams, two per row. Each tile has the icon,
 * the name (at most two lines) and a quiet line with the exam count; a category with a scheduled
 * exam running right now adds a red dot and the word "Live" on that line (never on top of the name,
 * and never colour alone). A tap opens the category's own screen. Hidden when it cannot load or
 * nothing has exams yet: Home never blocks on it. */
export function CategoryGrid() {
  const { t, i18n } = useTranslation();
  const { data } = useRemote(fetchCategories);
  // On a narrow phone a name beside its icon would break inside a word: the icon goes above instead.
  const narrow = useWindowDimensions().width < 370;
  if (!data?.length) return null;
  return (
    <Panel title={t("home:categories.title")}>
      <View style={panelStyles.grid}>
        {data.map((category, index) => {
          const Icon = ICONS[index % ICONS.length];
          const live = (category.live_count ?? 0) > 0;
          const name = tidyName(category.name);
          const count = t("home:categories.exams", { count: category.exam_count, n: localizeDigits(category.exam_count, i18n.language) });
          return (
            <Pressable
              key={category.slug}
              accessibilityRole="link"
              accessibilityLabel={[name, count, live ? t("home:categories.live") : null].filter(Boolean).join(", ")}
              onPress={() => router.push({ pathname: "/category/[slug]", params: { slug: category.slug, name } })}
              style={({ pressed }) => [panelStyles.tile, narrow && styles.stacked, pressed && panelStyles.pressed]}
            >
              <View style={panelStyles.icon}>
                <Icon size={22} color={colors.brand700} />
              </View>
              <View style={[panelStyles.tileText, narrow && styles.fullWidth]}>
                <AppText variant="small" weight="semibold" numberOfLines={2}>
                  {name}
                </AppText>
                <View style={styles.meta}>
                  <AppText variant="caption" color={colors.inkMuted}>
                    {count}
                  </AppText>
                  {live ? (
                    <View style={styles.liveMark} testID={`live-${category.slug}`}>
                      <View style={styles.dot} />
                      <AppText variant="caption" weight="bold" color={colors.danger700}>
                        {t("home:categories.liveShort")}
                      </AppText>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  stacked: { flexDirection: "column", alignItems: "flex-start", gap: 6 },
  fullWidth: { alignSelf: "stretch", flex: 0 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8 },
  liveMark: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: colors.danger700 },
});
