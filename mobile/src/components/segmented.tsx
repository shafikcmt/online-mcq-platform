import { Pressable, StyleSheet, View } from "react-native";

import { colors, radius, space } from "@/theme";

import { AppText } from "./app-text";

type Option<T extends string> = { value: T; label: string };

/** A short row of mutually exclusive filters (e.g. Open now · Upcoming · Past). A radio
 * group for screen readers; the selected one is also bold and outlined (not color alone). */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={styles.group} role="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            role="radio"
            aria-checked={selected}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.option, selected && styles.selected, pressed && !selected && styles.pressed]}
          >
            <AppText variant="small" weight={selected ? "bold" : "medium"} color={selected ? colors.brand700 : colors.inkMuted} align="center">
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: "row",
    gap: space.xs,
    padding: space.xs,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  option: { flex: 1, minHeight: 40, justifyContent: "center", borderRadius: radius.control, borderWidth: 1, borderColor: "transparent", paddingHorizontal: space.sm },
  selected: { backgroundColor: colors.brand50, borderColor: colors.brand100 },
  pressed: { backgroundColor: colors.canvas },
});
