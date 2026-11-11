import { Pressable, ScrollView, StyleSheet } from "react-native";

import { AppText } from "@/components/app-text";
import { colors, radius, space } from "@/theme";

import type { CategoryChoice } from "./categories";

/** A scrollable row of mutually exclusive category filters ("All" first). A radio group for screen
 * readers; the selected chip is also bold and outlined (not colour alone). */
export function CategoryChips({ label, allLabel, categories, value, onChange }: { label: string; allLabel: string; categories: CategoryChoice[]; value: string; onChange: (slug: string) => void }) {
  const options = [{ slug: "", name: allLabel }, ...categories];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} role="radiogroup" accessibilityLabel={label} contentContainerStyle={styles.row}>
      {options.map((option) => {
        const selected = option.slug === value;
        return (
          <Pressable
            key={option.slug || "all"}
            role="radio"
            aria-checked={selected}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.slug)}
            style={[styles.chip, selected && styles.selected]}
          >
            <AppText variant="small" weight={selected ? "bold" : "medium"} color={selected ? colors.brand700 : colors.inkMuted}>
              {option.name}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm, paddingVertical: space.xs },
  chip: { minHeight: 40, paddingHorizontal: space.lg, justifyContent: "center", borderRadius: radius.full, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  selected: { borderColor: colors.brand600, backgroundColor: colors.brand50, borderWidth: 2 },
});
