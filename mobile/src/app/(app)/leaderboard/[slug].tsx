import { useLocalSearchParams } from "expo-router";
import { Lock, Medal } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { isApiError } from "@/api/errors";
import { AppText } from "@/components/app-text";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { PagedList } from "@/components/paged-list";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchLeaderboard } from "@/features/results/api";
import { formatDuration } from "@/features/results/format";
import type { LeaderboardPage, LeaderboardRow } from "@/features/results/types";
import { fetchSamples, type SampleList } from "@/features/sample/api";
import { SampleBlock } from "@/features/sample/sample-block";
import { formatDecimal } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { usePages } from "@/lib/use-pages";
import { colors, radius, space } from "@/theme";

const keyOf = (row: LeaderboardRow) => String(row.position);

/** The exam's merit list as the server generated it. Other students' names come already
 * shortened by the server's privacy setting (the student sees their own name in full);
 * phone numbers and emails are never sent. */
export default function LeaderboardScreen() {
  const { t, i18n } = useTranslation();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const load = useCallback((page: number) => fetchLeaderboard(slug, page), [slug]);
  const list = usePages<LeaderboardRow, LeaderboardPage>(load, slug, keyOf);
  // Sample participants (labelled, unranked, separate); nothing is shown when there are none.
  const [samples, setSamples] = useState<SampleList | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchSamples(slug).then((found) => alive && setSamples(found));
    return () => {
      alive = false;
    };
  }, [slug]);
  const n = (value: number) => localizeDigits(value, i18n.language);
  const mine = list.extra?.my_position ?? null;
  const code = isApiError(list.error) ? list.error.code : null;
  const refused = code === "merit_disabled" || code === "result_not_visible";

  const header = (
    <>
      <PageHeader title={t("results:leaderboard.title")} />
      {list.extra ? (
        <Card style={styles.mine}>
          <Medal size={28} color={colors.brand700} />
          <View style={styles.mineText}>
            <AppText weight="bold">{mine !== null ? t("results:leaderboard.yourPosition", { n: n(mine) }) : t("results:leaderboard.notRanked")}</AppText>
            <AppText variant="small" color={colors.inkMuted}>
              {t("results:leaderboard.count", { n: n(list.count) })}
            </AppText>
          </View>
        </Card>
      ) : null}
    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <PagedList<LeaderboardRow>
        testID="leaderboard"
        list={list}
        keyOf={keyOf}
        header={header}
        footer={samples ? <SampleBlock data={samples} /> : null}
        renderItem={({ item }) => <Row row={item} />}
        empty={<EmptyNote text={t("results:leaderboard.empty")} />}
        errorView={
          refused ? (
            <View style={styles.center}>
              <Lock size={36} color={colors.inkSubtle} />
              <AppText color={colors.inkMuted} align="center">
                {code === "merit_disabled" ? t("results:leaderboard.disabled") : t("results:leaderboard.notVisible")}
              </AppText>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function Row({ row }: { row: LeaderboardRow }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const marks = t("home:result.marks", { obtained: formatDecimal(row.obtained_marks, language), total: formatDecimal(row.total_marks, language) });
  const percent = t("home:result.percent", { value: formatDecimal(row.percentage, language) });
  const top = row.position <= 3;
  return (
    <View
      style={[styles.row, row.is_me && styles.me]}
      accessible
      accessibilityLabel={t("results:leaderboard.row", { n: localizeDigits(row.position, language), name: row.is_me ? `${row.name} (${t("results:leaderboard.you")})` : row.name, marks, percent })}
    >
      <View style={[styles.position, top && styles.positionTop]}>
        <AppText weight="bold" color={top ? colors.brand800 : colors.inkMuted}>
          {localizeDigits(row.position, language)}
        </AppText>
      </View>
      <View style={styles.body}>
        <AppText weight={row.is_me ? "bold" : "semibold"} numberOfLines={1}>
          {row.name}
          {row.is_me ? ` · ${t("results:leaderboard.you")}` : ""}
        </AppText>
        <AppText variant="small" color={colors.inkMuted}>
          {formatDuration(row.time_used_seconds, t, language)}
        </AppText>
      </View>
      <View style={styles.score}>
        <AppText weight="bold">{marks}</AppText>
        <AppText variant="small" color={colors.inkMuted}>
          {percent}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: "center", gap: space.md, marginTop: space.huge },
  mine: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.brand50, borderColor: colors.brand100 },
  mineText: { flex: 1, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  me: { borderColor: colors.brand600, borderWidth: 2, backgroundColor: colors.brand50 },
  position: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  positionTop: { backgroundColor: colors.accent500 + "44" },
  body: { flex: 1, gap: 2 },
  score: { alignItems: "flex-end" },
});
