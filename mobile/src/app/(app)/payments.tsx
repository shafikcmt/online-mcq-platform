import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge, type BadgeTone } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { PagedList } from "@/components/paged-list";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchPayments } from "@/features/packages/api";
import { formatMoney } from "@/features/packages/money";
import type { Payment } from "@/features/packages/types";
import { formatDate } from "@/lib/format";
import { usePages, type Page } from "@/lib/use-pages";
import { colors, radius, space } from "@/theme";

const keyOf = (payment: Payment) => payment.payment_id;
const TONE: Record<Payment["status"], BadgeTone> = { pending: "warning", success: "success", failed: "danger", cancelled: "neutral" };

/** The student's own payments, newest first; each opens its status. */
export default function PaymentsScreen() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const load = useCallback((page: number) => fetchPayments(page), []);
  const list = usePages<Payment, Page<Payment>>(load, "payments", keyOf);
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <PagedList<Payment>
        testID="payment-list"
        list={list}
        keyOf={keyOf}
        header={<PageHeader title={t("packages:history")} />}
        empty={<EmptyNote text={t("packages:historyEmpty")} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={[item.package.name, formatMoney(item.amount, item.currency, language), t(`packages:payment.status.${item.status}`)].join(", ")}
            onPress={() => router.push({ pathname: "/payment/[id]", params: { id: item.payment_id } })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.body}>
              <AppText weight="semibold">{item.package.name}</AppText>
              <AppText variant="small" color={colors.inkMuted}>
                {formatMoney(item.amount, item.currency, language)} · {formatDate(item.created_at, language)}
              </AppText>
              <Badge label={t(`packages:payment.status.${item.status}`)} tone={TONE[item.status]} />
            </View>
            <ChevronRight size={20} color={colors.inkSubtle} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pressed: { backgroundColor: colors.brand50 },
  body: { flex: 1, gap: space.xs },
});
