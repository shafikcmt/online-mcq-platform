import { router } from "expo-router";
import { BookOpenCheck, Briefcase, Building2, GraduationCap, Landmark, Stethoscope, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { localizeDigits } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { colors, radius } from "@/theme";

import { fetchCategories } from "./api";
import { Panel, panelStyles } from "./panel";

/** Neutral icons in turn (categories are admin-defined, so no icon is tied to a name). */
const ICONS: LucideIcon[] = [GraduationCap, Stethoscope, BookOpenCheck, Landmark, Building2, Briefcase];

/** The exam section of Home: every category that has exams, two per row. A red dot marks a
 * category with a scheduled exam running right now (the label says "live now" too, so colour is
 * never the only signal). A tap opens the category's own screen. Hidden when it cannot load or
 * nothing has exams yet: Home never blocks on it. */
export function CategoryGrid() {
  const { t, i18n } = useTranslation();
  const { data } = useRemote(fetchCategories);
  if (!data?.length) return null;
  return (
    <Panel title={t("home:categories.title")}>
      <View style={panelStyles.grid}>
        {data.map((category, index) => {
          const Icon = ICONS[index % ICONS.length];
          const live = (category.live_count ?? 0) > 0;
          const count = t("home:categories.exams", { count: category.exam_count, n: localizeDigits(category.exam_count, i18n.language) });
          return (
            <Pressable
              key={category.slug}
              accessibilityRole="link"
              accessibilityLabel={[category.name, count, live ? t("home:categories.live") : null].filter(Boolean).join(", ")}
              onPress={() => router.push({ pathname: "/category/[slug]", params: { slug: category.slug, name: category.name } })}
              style={({ pressed }) => [panelStyles.tile, pressed && panelStyles.pressed]}
            >
              <Icon size={22} color={colors.brand700} />
              <AppText variant="small" weight="semibold" numberOfLines={2} style={panelStyles.tileText}>
                {category.name}
              </AppText>
              {live ? <View style={styles.dot} testID={`live-${category.slug}`} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  dot: { position: "absolute", top: 6, right: 6, width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.danger700 },
});
