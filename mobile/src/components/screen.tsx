import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ScrollViewProps } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { colors, space } from "@/theme";

type Props = {
  children: React.ReactNode;
  /** Pinned under the scrolling content (e.g. the primary button). */
  footer?: React.ReactNode;
  edges?: Edge[];
  refreshControl?: ScrollViewProps["refreshControl"];
};

/** Safe-area + keyboard-aware scrolling page with the app background. Content is limited
 * to a readable width on tablets. */
export function Screen({ children, footer, edges = ["top", "bottom"], refreshControl }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          <View style={styles.inner}>{children}</View>
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingVertical: space.xxl },
  inner: { width: "100%", maxWidth: 560, alignSelf: "center", gap: space.xl },
  footer: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
});
