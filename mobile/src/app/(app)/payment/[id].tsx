import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2, CircleX, Hourglass } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { openCheckout } from "@/features/packages/checkout";
import { formatMoney } from "@/features/packages/money";
import type { Payment } from "@/features/packages/types";
import { usePaymentStatus } from "@/features/packages/use-payment-status";
import { formatDateTime } from "@/lib/format";
import { colors, space } from "@/theme";

/** After checkout: what the server says about the payment. Paid only when the server
 * verified it with the provider (`success`); the provider page or the return link never
 * decide. While pending it keeps asking for a while, then offers to check again. */
export default function PaymentScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { payment, error, polling, checkAgain } = usePaymentStatus(id);

  return (
    <Screen>
      <PageHeader title={t("packages:payment.title")} onBack={() => (router.canGoBack() ? router.back() : router.replace("/packages"))} />
      {!payment && !error ? <Checking /> : null}
      {!payment && error ? (
        <>
          <Banner tone="error" message={describeError(error, t)} />
          <Button label={t("packages:payment.checkAgain")} variant="secondary" onPress={checkAgain} />
        </>
      ) : null}
      {payment ? <State payment={payment} polling={polling} checkAgain={checkAgain} /> : null}
    </Screen>
  );
}

function Checking() {
  const { t } = useTranslation();
  return (
    <View style={styles.center} accessible accessibilityLabel={t("packages:payment.checking")} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.brand600} />
      <AppText color={colors.inkMuted} align="center">
        {t("packages:payment.checking")}
      </AppText>
    </View>
  );
}

function State({ payment, polling, checkAgain }: { payment: Payment; polling: boolean; checkAgain: () => void }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const facts: [string, string][] = [
    [t("packages:payment.package"), payment.package.name],
    [t("packages:payment.amount"), formatMoney(payment.amount, payment.currency, language)],
    [t("packages:payment.reference"), payment.merchant_reference],
  ];
  if (payment.transaction_id) facts.push([t("packages:payment.transaction"), payment.transaction_id]);
  facts.push([t("packages:payment.date"), formatDateTime(payment.verified_at ?? payment.created_at, language)]);

  let hero: React.ReactNode;
  let actions: React.ReactNode;
  if (payment.status === "success") {
    hero = <Hero icon={<CheckCircle2 size={48} color={colors.success700} />} title={t("packages:payment.success")} body={t("packages:payment.successBody", { package: payment.package.name })} />;
    actions = <Button label={t("packages:payment.goExams")} onPress={() => router.replace("/exams")} />;
  } else if (payment.status === "pending") {
    hero = polling ? (
      <Checking />
    ) : (
      <Hero icon={<Hourglass size={48} color={colors.warning700} />} title={t("packages:payment.status.pending")} body={t("packages:payment.stillPending")} />
    );
    actions = polling ? null : (
      <>
        <Button label={t("packages:payment.checkAgain")} onPress={checkAgain} />
        {payment.checkout_url ? (
          <Button
            label={t("packages:payment.reopen")}
            variant="secondary"
            onPress={async () => {
              await openCheckout(payment.checkout_url!);
              checkAgain();
            }}
          />
        ) : null}
      </>
    );
  } else {
    const failed = payment.status === "failed";
    hero = (
      <Hero
        icon={<CircleX size={48} color={colors.danger700} />}
        title={t(failed ? "packages:payment.failed" : "packages:payment.cancelled")}
        body={t(failed ? "packages:payment.failedBody" : "packages:payment.cancelledBody")}
      />
    );
    actions = <Button label={t("packages:payment.tryAgain")} variant="secondary" onPress={() => router.replace("/packages")} />;
  }

  return (
    <>
      {hero}
      {payment.is_test ? (
        <AppText variant="small" color={colors.warning700} align="center">
          {t("packages:testNote")}
        </AppText>
      ) : null}
      <Card style={styles.facts}>
        {facts.map(([label, value], index) => (
          <View key={label} style={[styles.fact, index > 0 && styles.factLine]}>
            <AppText variant="small" color={colors.inkMuted} style={styles.factLabel}>
              {label}
            </AppText>
            <AppText variant="small" weight="semibold" style={styles.factValue} selectable>
              {value}
            </AppText>
          </View>
        ))}
      </Card>
      {actions}
    </>
  );
}

function Hero({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      {icon}
      <AppText variant="h3" weight="bold" align="center" role="heading">
        {title}
      </AppText>
      <AppText color={colors.inkMuted} align="center">
        {body}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: space.md, marginTop: space.xl },
  facts: { gap: space.xs },
  fact: { flexDirection: "row", gap: space.md, paddingVertical: space.sm },
  factLine: { borderTopWidth: 1, borderTopColor: colors.line },
  factLabel: { flex: 1 },
  factValue: { flexShrink: 1, textAlign: "right" },
});
