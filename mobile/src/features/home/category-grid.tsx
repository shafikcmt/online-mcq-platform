import { router } from "expo-router";
import { BookOpenCheck, Briefcase, Building2, GraduationCap, Landmark, Stethoscope, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { localizeDigits } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { colors, radius, space } from "@/theme";

import { fetchCategories } from "./api";

/** Neutral icons in turn (categories are admin-defined, so no icon is tied to a name). */
const ICONS: LucideIcon[] = [GraduationCap, Stethoscope, BookOpenCheck, Landmark, Building2, Briefcase];

/** Exam categories that have exams, two per row, each with its exam count; a tap opens
 * the Exams tab filtered to that category. Hidden when it cannot load or nothing has
 * exams yet — Home never blocks on it. */
export function CategoryGrid() {
  const { t, i18n } = useTranslation();
  const { data } = useRemote(fetchCategories);
  if (!data?.length) return null;
  return (
    <View style={styles.section}>
      <AppText variant="lead" weight="bold" role="heading">
        {t("home:categories.title")}
      </AppText>
      <View style={styles.grid}>
        {data.map((category, index) => {
          const Icon = ICONS[index % ICONS.length];
          const count = t("home:categories.exams", { count: category.exam_count, n: localizeDigits(category.exam_count, i18n.language) });
          return (
            <Pressable
              key={category.slug}
              accessibilityRole="link"
              accessibilityLabel={`${category.name}, ${count}`}
              onPress={() => router.push({ pathname: "/exams", params: { category: category.slug, categoryName: category.name } })}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            >
              <View style={styles.icon}>
                <Icon size={20} color={colors.brand600} />
              </View>
              <View style={styles.text}>
                <AppText weight="semibold" numberOfLines={2}>
                  {category.name}
                </AppText>
                <AppText variant="caption" color={colors.inkMuted}>
                  {count}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    minHeight: 64,
    borderRadius: radius.sheet,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  icon: { width: 40, height: 40, borderRadius: radius.card, backgroundColor: colors.brand50, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  pressed: { opacity: 0.85 },
});
