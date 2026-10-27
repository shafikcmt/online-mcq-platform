import { Bell, CloudOff } from "lucide-react-native";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { useAuth } from "@/auth/provider";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Screen } from "@/components/screen";
import { fetchDashboard } from "@/features/dashboard/api";
import { ExamCard } from "@/features/exams/exam-card";
import { ResultRow } from "@/features/results/result-row";
import { EmptyNote, Section } from "@/features/dashboard/section";
import { SubscriptionCard } from "@/features/dashboard/subscription-card";
import type { Dashboard } from "@/features/dashboard/types";
import { localizeDigits } from "@/lib/text";
import { useRemote } from "@/lib/use-remote";
import { useServerNow } from "@/lib/use-server-now";
import { colors, radius, space } from "@/theme";

/** Home: everything the student needs at a glance, from one call (`GET /me/dashboard/`):
 * exams open now, upcoming and practice exams, active packages, recent results and the
 * unread notification count. Reloads quietly whenever Home comes back into view, and on
 * pull-to-refresh. All times are counted from the server's clock. */
export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { data, error, loading, refreshing, refresh, retry } = useRemote(fetchDashboard);
  const now = useServerNow(data?.server_time);
  const name = user?.display_name || user?.full_name.split(" ")[0] || "";
  const unread = data?.notifications.unread_count ?? 0;

  return (
    <Screen
      edges={["top"]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand600]} tintColor={colors.brand600} />
      }
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="h3" weight="bold" role="heading">
            {t("home:greeting", { name })}
          </AppText>
          <AppText color={colors.inkMuted}>{t("home:subtitle")}</AppText>
        </View>
        {data ? (
          <View
            style={styles.bell}
            accessible
            accessibilityLabel={unread > 0 ? t("home:unread", { n: localizeDigits(unread, i18n.language) }) : t("home:noUnread")}
          >
            <Bell size={22} color={colors.inkMuted} />
            {unread > 0 ? (
              <View style={styles.dot}>
                <AppText variant="caption" weight="bold" color={colors.white}>
                  {localizeDigits(unread > 99 ? "99+" : unread, i18n.language)}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {loading ? <Skeleton label={t("loading")} /> : null}
      {!loading && !data && error ? <LoadFailed message={describeError(error, t)} onRetry={retry} /> : null}
      {data && error ? <Banner tone="info" message={t("home:stale")} /> : null}
      {data ? <Content data={data} now={now} /> : null}
    </Screen>
  );
}

function Content({ data, now }: { data: Dashboard; now: number }) {
  const { t } = useTranslation();
  const { available, upcoming, practice } = data.exams;
  return (
    <>
      <SubscriptionCard subscription={data.subscription} />
      <Section title={t("home:sections.available")} count={available.count} shown={available.items.length} seeAll="/exams?when=open">
        {available.items.length ? (
          available.items.map((exam) => <ExamCard key={exam.slug} exam={exam} now={now} />)
        ) : (
          <EmptyNote text={t("home:empty.available")} />
        )}
      </Section>
      {upcoming.count > 0 ? (
        <Section title={t("home:sections.upcoming")} count={upcoming.count} shown={upcoming.items.length} seeAll="/exams?when=upcoming">
          {upcoming.items.map((exam) => (
            <ExamCard key={exam.slug} exam={exam} now={now} upcoming />
          ))}
        </Section>
      ) : null}
      {practice.count > 0 ? (
        <Section title={t("home:sections.practice")} count={practice.count} shown={practice.items.length}>
          {practice.items.map((exam) => (
            <ExamCard key={exam.slug} exam={exam} now={now} />
          ))}
        </Section>
      ) : null}
      <Section title={t("home:sections.results")} count={data.results.count} shown={data.results.items.length} seeAll="/results">
        {data.results.items.length ? (
          <Card style={styles.results}>
            {data.results.items.map((result, index) => (
              <View key={result.attempt_id} style={index > 0 ? styles.divider : undefined}>
                <ResultRow result={result} />
              </View>
            ))}
          </Card>
        ) : (
          <EmptyNote text={t("home:empty.results")} />
        )}
      </Section>
    </>
  );
}

/** Placeholder blocks in the shape of the page while the first load runs. */
function Skeleton({ label }: { label: string }) {
  return (
    <View style={styles.skeleton} accessible accessibilityLabel={label} accessibilityState={{ busy: true }}>
      {[72, 112, 112, 88].map((height, index) => (
        <View key={index} style={[styles.block, { height }]} />
      ))}
    </View>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.failed}>
      <CloudOff size={36} color={colors.inkSubtle} />
      <AppText color={colors.inkMuted} align="center" role="alert">
        {message}
      </AppText>
      <Button label={t("retry")} variant="secondary" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  headerText: { flex: 1, gap: space.xs },
  bell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: radius.full,
    backgroundColor: colors.danger700,
    alignItems: "center",
    justifyContent: "center",
  },
  results: { paddingVertical: space.xs },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  skeleton: { gap: space.lg },
  block: { borderRadius: radius.card, backgroundColor: colors.line },
  failed: { alignItems: "center", gap: space.md, marginTop: space.huge },
});
