import { AlertCircle, CheckCircle2, Info } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { colors, radius, space } from "@/theme";

import { AppText } from "./app-text";

type Tone = "error" | "success" | "info";

const TONES: Record<Tone, { bg: string; fg: string; Icon: typeof Info }> = {
  error: { bg: colors.danger50, fg: colors.danger700, Icon: AlertCircle },
  success: { bg: colors.success50, fg: colors.success700, Icon: CheckCircle2 },
  info: { bg: colors.info50, fg: colors.info700, Icon: Info },
};

/** Inline message with icon + text (never color alone). Errors are announced. */
export function Banner({ tone, message }: { tone: Tone; message: string }) {
  const { bg, fg, Icon } = TONES[tone];
  return (
    <View
      style={[styles.box, { backgroundColor: bg, borderColor: fg + "40" }]}
      role={tone === "error" ? "alert" : undefined}
      accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
    >
      <Icon size={20} color={fg} style={styles.icon} />
      <AppText variant="small" color={fg} style={styles.text}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", gap: space.sm, borderWidth: 1, borderRadius: radius.control, padding: space.md },
  icon: { marginTop: 2 },
  text: { flex: 1 },
});
