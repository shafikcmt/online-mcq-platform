import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { PagedList } from "@/components/paged-list";
import { Segmented } from "@/components/segmented";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchHistory, fetchResults } from "@/features/results/api";
import { HistoryRow } from "@/features/results/history-row";
import { ResultRow } from "@/features/results/result-row";
import type { HistoryItem, ResultDetail } from "@/features/results/types";
import { serverNow } from "@/lib/server-clock";
import { usePages } from "@/lib/use-pages";
import { colors, radius, space } from "@/theme";

type View_ = "results" | "history";
const VIEWS: View_[] = ["results", "history"];
const idOf = (item: { attempt_id: string }) => item.attempt_id;

/** Results tab: published results (newest first) and the full history of attempts,
 * including ones whose result is not out yet and ones still in progress. */
export default function ResultsScreen() {
  const { t } = useTranslation();
  const [view, setView] = useState<View_>("results");
  const header = (
    <>
      <View style={styles.titleBlock}>
        <AppText variant="h3" weight="bold" role="heading">
          {t("results:title")}
        </AppText>
        <AppText color={colors.inkMuted}>{t("results:subtitle")}</AppText>
      </View>
      <Segmented label={t("results:filters.label")} value={view} onChange={setView} options={VIEWS.map((value) => ({ value, label: t(`results:filters.${value}`) }))} />
    </>
  );
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {view === "results" ? <ResultsList header={header} /> : <HistoryList header={header} />}
    </SafeAreaView>
  );
}

function ResultsList({ header }: { header: React.ReactElement }) {
  const { t } = useTranslation();
  const load = useCallback((page: number) => fetchResults(page), []);
  const list = usePages<ResultDetail, Awaited<ReturnType<typeof fetchResults>>>(load, "results", idOf);
  return (
    <PagedList<ResultDetail>
      testID="results-list"
      list={list}
      keyOf={idOf}
      header={header}
      separator={false}
      renderItem={({ item, index }) => (
        <View style={[styles.card, index === 0 && styles.first, index === list.items.length - 1 && styles.last, index > 0 && styles.divider]}>
          <ResultRow result={item} />
        </View>
      )}
      empty={<EmptyNote text={t("results:empty.results")} />}
    />
  );
}

function HistoryList({ header }: { header: React.ReactElement }) {
  const { t } = useTranslation();
  const load = useCallback((page: number) => fetchHistory(page), []);
  const list = usePages<HistoryItem, Awaited<ReturnType<typeof fetchHistory>>>(load, "history", idOf);
  return (
    <PagedList<HistoryItem>
      testID="history-list"
      list={list}
      keyOf={idOf}
      header={header}
      renderItem={({ item }) => <HistoryRow item={item} now={serverNow()} />}
      empty={<EmptyNote text={t("results:empty.history")} />}
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  titleBlock: { gap: space.xs },
  card: { backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line, paddingHorizontal: space.md },
  first: { borderTopWidth: 1, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  last: { borderBottomWidth: 1, borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
});
