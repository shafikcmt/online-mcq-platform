import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { colors, radius, space } from "@/theme";

import { AppText } from "./app-text";
import { Button } from "./button";

type Props = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Our own confirmation sheet (consistent on Android and in the web QA build, where the
 * native Alert does nothing). Back button / tapping outside cancels. */
export function ConfirmDialog({ open, title, body, confirmLabel, tone = "primary", busy, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onCancel} accessibilityLabel={t("cancel")} />
        <View style={styles.sheet} role="alertdialog" aria-modal accessibilityLabel={title}>
          <AppText variant="h4" weight="bold" role="heading">
            {title}
          </AppText>
          <AppText color={colors.inkMuted}>{body}</AppText>
          <View style={styles.actions}>
            <Button label={confirmLabel} variant={tone} onPress={onConfirm} loading={busy} />
            <Button label={t("cancel")} variant="secondary" onPress={onCancel} disabled={busy} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.45)", justifyContent: "center", padding: space.lg },
  sheet: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sheet,
    padding: space.xxl,
    gap: space.md,
  },
  actions: { gap: space.sm, marginTop: space.sm },
});
