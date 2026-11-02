import { CheckCircle2 } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, space } from "@/theme";

import { AppText } from "./app-text";

const ToastContext = createContext<(message: string) => void>(() => {});

/** Short confirmation at the bottom of the screen for ~3 s, announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const notify = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(null), 3200);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {message ? (
        <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 88 }]}>
          <View style={styles.toast} role="status" accessibilityLiveRegion="polite">
            <CheckCircle2 size={18} color={colors.white} />
            <AppText variant="small" weight="medium" color={colors.white} style={styles.text}>
              {message}
            </AppText>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: space.lg, right: space.lg, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    maxWidth: 520,
    backgroundColor: colors.ink,
    borderRadius: radius.sheet,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  text: { flexShrink: 1 },
});
