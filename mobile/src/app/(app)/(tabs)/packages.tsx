import { router } from "expo-router";
import { Receipt } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PagedList } from "@/components/paged-list";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchPackages, initiatePayment } from "@/features/packages/api";
import { newPaymentKey, openCheckout } from "@/features/packages/checkout";
import { formatMoney } from "@/features/packages/money";
import { PackageCard } from "@/features/packages/package-card";
import type { Package } from "@/features/packages/types";
import { formatDate } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { usePages, type Page } from "@/lib/use-pages";
import { colors, space, touchTarget } from "@/theme";

const keyOf = (pkg: Package) => pkg.slug;

/** Packages tab: what is on sale (prices from the server) and the student's own current
 * subscriptions. Buying: confirm → the server opens a payment (only the package is sent)
 * → the provider's page in an in-app browser → the payment screen asks the server whether
 * it is paid. The app never decides that a payment succeeded. */
export default function PackagesScreen() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const load = useCallback((page: number) => fetchPackages(page), []);
  const list = usePages<Package, Page<Package>>(load, "packages", keyOf);
  const [chosen, setChosen] = useState<Package | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  async function buy(pkg: Package) {
    setChosen(null);
    setBusy(pkg.slug);
    setFailure(null);
    try {
      const payment = await initiatePayment(pkg.id, newPaymentKey());
      if (payment.checkout_url) await openCheckout(payment.checkout_url);
      router.push({ pathname: "/payment/[id]", params: { id: payment.payment_id } });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  }

  const days = (pkg: Package) => t("packages:validity", { count: pkg.validity_days, n: localizeDigits(pkg.validity_days, language) });
  const header = (
    <>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <AppText variant="h3" weight="bold" role="heading">
            {t("packages:title")}
          </AppText>
          <AppText color={colors.inkMuted}>{t("packages:subtitle")}</AppText>
        </View>
        <Pressable accessibilityRole="link" accessibilityLabel={t("packages:history")} onPress={() => router.push("/payments")} hitSlop={8} style={styles.history}>
          <Receipt size={22} color={colors.brand700} />
        </Pressable>
      </View>
      {failure ? <Banner tone="error" message={describeError(failure, t)} /> : null}
    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <PagedList<Package>
        testID="package-list"
        list={list}
        keyOf={keyOf}
        header={header}
        renderItem={({ item }) => <PackageCard pkg={item} busy={busy === item.slug} onBuy={() => setChosen(item)} />}
        empty={<EmptyNote text={t("packages:empty")} />}
      />
      {chosen ? (
        <ConfirmDialog
          open
          title={t("packages:confirmTitle", { name: chosen.name })}
          body={
            chosen.subscription
              ? t("packages:extendBody", { price: formatMoney(chosen.price, chosen.currency, language), days: days(chosen), date: formatDate(chosen.subscription.expires_at, language) })
              : t("packages:confirmBody", { price: formatMoney(chosen.price, chosen.currency, language), days: days(chosen) })
          }
          confirmLabel={t("packages:pay")}
          onConfirm={() => void buy(chosen)}
          onCancel={() => setChosen(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  titleBlock: { flex: 1, gap: space.xs },
  history: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center" },
});
