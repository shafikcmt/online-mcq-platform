import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { colors, space, touchTarget } from "@/theme";

import { AppText } from "./app-text";

type Props = { title: string; subtitle?: string; eyebrow?: string; onBack?: (() => void) | false };

/** Screen title block with an optional back button (default: go back in the stack). */
export function PageHeader({ title, subtitle, eyebrow, onBack }: Props) {
  const { t } = useTranslation();
  const back = onBack === false ? null : (onBack ?? (router.canGoBack() ? () => router.back() : null));
  return (
    <View style={styles.wrap}>
      {back ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={back} hitSlop={8} style={styles.back}>
          <ArrowLeft size={24} color={colors.ink} />
        </Pressable>
      ) : null}
      {eyebrow ? (
        <AppText variant="small" weight="medium" color={colors.brand700}>
          {eyebrow}
        </AppText>
      ) : null}
      <AppText variant="h3" weight="bold" role="heading">
        {title}
      </AppText>
      {subtitle ? <AppText color={colors.inkMuted}>{subtitle}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  back: { width: touchTarget, height: touchTarget, marginLeft: -space.md, alignItems: "center", justifyContent: "center" },
});
